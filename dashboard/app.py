"""Streamlit dashboard for the persisted irrigation advisory model."""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import streamlit as st

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.advisory import load_config, risk_level
from src.data_loader import DEFAULT_DATA_PATH, load_data
from src.features import geometry_center, parse_geometry
from src.predict import load_artifact, predict_batch, predict_record, what_if
from src.train import DEFAULT_MODEL_PATH


st.set_page_config(page_title="Sugarcane Irrigation Advisory", page_icon="💧", layout="wide")


@st.cache_resource
def get_artifact():
    return load_artifact(DEFAULT_MODEL_PATH)


@st.cache_data
def get_data() -> pd.DataFrame:
    return load_data(DEFAULT_DATA_PATH)


@st.cache_data
def scored_farms() -> pd.DataFrame:
    artifact = get_artifact()
    farms = get_data().copy()
    farms["Predicted_Soil_Moisture"] = predict_batch(artifact, farms)
    config = load_config()
    farms["Risk_Level"] = farms["Predicted_Soil_Moisture"].map(lambda value: risk_level(float(value), config))
    return farms


def _option(frame: pd.DataFrame, column: str, label: str) -> str:
    values = ["All"] + sorted(frame[column].dropna().astype(str).unique().tolist())
    return st.selectbox(label, values, key=f"filter_{column}")


def render_map(farms: pd.DataFrame) -> None:
    valid = farms[farms[".geo"].map(parse_geometry).notna()].copy()
    if valid.empty:
        st.info("No valid GeoJSON polygons are available. Showing farm records instead.")
        st.dataframe(farms[["Farm_ID", "District", "Taluk", "Village", "Risk_Level"]])
        return
    try:
        import folium
        from streamlit_folium import st_folium
    except ImportError:
        st.warning("Map dependencies are unavailable. Install requirements.txt to enable the interactive map.")
        st.dataframe(valid[["Farm_ID", "District", "Taluk", "Village", "Risk_Level"]])
        return

    centers = valid[".geo"].map(geometry_center)
    center_lon = float(centers.map(lambda item: item[0]).mean())
    center_lat = float(centers.map(lambda item: item[1]).mean())
    farm_map = folium.Map(location=[center_lat, center_lon], zoom_start=11, control_scale=True)
    colors = {"LOW": "#2e7d32", "MODERATE": "#f9a825", "HIGH": "#c62828"}
    for _, farm in valid.iterrows():
        color = colors.get(farm["Risk_Level"], "#607d8b")
        tooltip = (
            f"Farm: {farm['Farm_ID']}<br>"
            f"Location: {farm['Village']}, {farm['Taluk']}<br>"
            f"Predicted soil moisture: {farm['Predicted_Soil_Moisture']:.2%}<br>"
            f"Risk: {farm['Risk_Level']}"
        )
        folium.GeoJson(
            parse_geometry(farm[".geo"]),
            style_function=lambda _feature, fill=color: {"fillColor": fill, "color": fill, "weight": 1, "fillOpacity": 0.45},
            tooltip=folium.Tooltip(tooltip),
        ).add_to(farm_map)
    st_folium(farm_map, height=520, use_container_width=True)
    st.caption("Polygon colours show model-derived prototype risk: green low, amber moderate, red high.")


def main() -> None:
    st.title("Sugarcane irrigation advisory prototype")
    st.caption(
        "This demonstration predicts soil moisture from the supplied dataset. Risk thresholds and what-if "
        "results are configurable simulations, not validated irrigation prescriptions or weather forecasts."
    )
    if not DEFAULT_MODEL_PATH.exists():
        st.error("No saved model is available. Run `python -m src.train` from the project root first.")
        st.stop()

    artifact = get_artifact()
    farms = scored_farms()
    counts = farms["Risk_Level"].value_counts()
    metrics = artifact["metadata"]["test_metrics"]
    card1, card2, card3, card4, card5, card6 = st.columns(6)
    card1.metric("Total farms", f"{len(farms):,}")
    card2.metric("Farms analyzed", f"{len(farms):,}")
    card3.metric("Average predicted moisture", f"{farms['Predicted_Soil_Moisture'].mean():.2%}")
    card4.metric("High risk", int(counts.get("HIGH", 0)))
    card5.metric("Moderate risk", int(counts.get("MODERATE", 0)))
    card6.metric("Low risk", int(counts.get("LOW", 0)))
    st.caption(
        f"Saved model: {artifact['metadata']['model_name']} | Held-out test RMSE: {metrics['rmse']:.4f} "
        f"| R²: {metrics['r2']:.3f}"
    )

    st.subheader("Farm search")
    filters = st.columns(3)
    with filters[0]:
        district = _option(farms, "District", "District")
    filtered = farms if district == "All" else farms[farms["District"].astype(str) == district]
    with filters[1]:
        taluk = _option(filtered, "Taluk", "Taluk")
    filtered = filtered if taluk == "All" else filtered[filtered["Taluk"].astype(str) == taluk]
    with filters[2]:
        village = _option(filtered, "Village", "Village")
    filtered = filtered if village == "All" else filtered[filtered["Village"].astype(str) == village]
    farm_id = st.selectbox("Farm ID", filtered["Farm_ID"].tolist())
    selected = filtered.loc[filtered["Farm_ID"] == farm_id].iloc[0]
    result = predict_record(artifact, selected, farm_id=str(farm_id))
    advisory = result["advisory"]

    st.subheader("Farm details and advisory")
    details, advice_column = st.columns([1.35, 1])
    with details:
        fields = [
            "Farm_Area_ha", "NDVI", "LAI", "Rainfall_mm", "Temperature_C", "Relative_Humidity", "Soil_pH", "Organic_Carbon"
        ]
        st.dataframe(pd.DataFrame({"Field": fields, "Value": [selected[field] for field in fields]}), hide_index=True, width="stretch")
        st.caption(f"Location: {selected['Village']}, {selected['Taluk']}, {selected['District']}")
    with advice_column:
        st.metric("Predicted soil moisture", f"{advisory['predicted_soil_moisture']:.2%}")
        st.metric("Prototype risk", advisory["risk_level"])
        st.write(advisory["recommendation"])
        st.caption(advisory["threshold_note"])

    st.subheader("Explainable AI")
    st.caption("Local feature effects use one-at-a-time baseline replacement, not causal attribution.")
    contributions = pd.DataFrame(result["explanation"]["contributions"]).head(8)
    if not contributions.empty:
        st.bar_chart(contributions.set_index("feature")["contribution"])
        st.dataframe(contributions, hide_index=True, width="stretch")

    st.subheader("Interactive farm map")
    render_map(filtered)

    st.subheader("What-if simulator")
    st.caption("Change environmental inputs and rerun the saved model. This is a simulation, not a weather forecast.")
    controls = st.columns(3)
    with controls[0]:
        rainfall = st.number_input("Rainfall (mm)", min_value=0.0, value=float(selected["Rainfall_mm"]), step=1.0)
    with controls[1]:
        temperature = st.number_input("Temperature (°C)", value=float(selected["Temperature_C"]), step=0.1)
    with controls[2]:
        humidity = st.number_input("Relative humidity (%)", min_value=0.0, max_value=100.0, value=float(selected["Relative_Humidity"]), step=0.1)
    if st.button("Run what-if simulation", type="primary"):
        simulation = what_if(
            artifact,
            selected,
            {"Rainfall_mm": rainfall, "Temperature_C": temperature, "Relative_Humidity": humidity},
        )
        original = simulation["original"]["advisory"]
        changed = simulation["simulated"]["advisory"]
        current, arrow, future = st.columns([1, 0.3, 1])
        current.metric("Original prediction", f"{original['predicted_soil_moisture']:.2%}", original["risk_level"])
        arrow.markdown("### →")
        future.metric("What-if prediction", f"{changed['predicted_soil_moisture']:.2%}", changed["risk_level"])
        st.write(f"Prediction change: {simulation['prediction_change']:+.6f}")
        st.info(simulation["simulation_note"])


if __name__ == "__main__":
    main()
