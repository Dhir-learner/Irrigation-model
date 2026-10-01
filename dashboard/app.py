"""Streamlit dashboard: AI-assisted irrigation advisory for sugarcane (KJS-AGR-01)."""

from __future__ import annotations

import json
import sys
from datetime import date, timedelta
from pathlib import Path

import altair as alt
import pandas as pd
import streamlit as st

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.advisory import load_config, risk_level
from src.agronomy import FarmConditions, agronomy_config, irrigation_plan, soil_properties
from src.calibration import rootzone_moisture
from src.coverage import AI_MODELS, WORKFLOW_STAGES
from src.data_loader import DEFAULT_DATA_PATH, load_data
from src.database import log_feedback, read_feedback
from src.decision import farm_decision
from src.features import geometry_center, parse_geometry
from src.multilingual import LANGUAGES, llm_advisory
from src.predict import load_artifact, predict_batch, predict_record, what_if
from src.scheduling import schedule_feeder
from src.train import DEFAULT_MODEL_PATH

st.set_page_config(page_title="Sugarcane Irrigation Advisory", page_icon="💧", layout="wide")

REPORTS = PROJECT_ROOT / "reports"
# Reserved status palette; always paired with a text label, never colour alone.
STATUS_STYLE = {
    "IRRIGATE_NOW": {"label": "Irrigate now", "color": "#d03b3b", "icon": "🔴"},
    "IRRIGATE_SOON": {"label": "Irrigate within 3 days", "color": "#fab219", "icon": "🟡"},
    "NOT_REQUIRED": {"label": "Not required yet", "color": "#0ca30c", "icon": "🟢"},
}
SOURCE_LABEL = {"sensor": "field sensor", "ml_model": "ML model estimate"}


# --------------------------------------------------------------------- caching


@st.cache_resource
def get_artifact():
    return load_artifact(DEFAULT_MODEL_PATH)


@st.cache_data
def scored_farms() -> pd.DataFrame:
    farms = load_data(DEFAULT_DATA_PATH).copy()
    farms["Predicted_Soil_Moisture"] = predict_batch(get_artifact(), farms)
    config = load_config()
    farms["Risk_Level"] = farms["Predicted_Soil_Moisture"].map(lambda value: risk_level(float(value), config))
    centers = farms[".geo"].map(geometry_center)
    farms["Longitude"] = centers.map(lambda pair: pair[0])
    farms["Latitude"] = centers.map(lambda pair: pair[1])
    return farms


@st.cache_data
def fleet_plans(crop_age: int, soil_type: str, method: str, pump_flow: float, start: date) -> pd.DataFrame:
    """Run the FAO-56 engine for every farm with shared crop and equipment settings."""
    config = load_config()
    _, fc, wp = soil_properties(agronomy_config(config), soil_type)
    farms = scored_farms()
    reference = farms["Predicted_Soil_Moisture"].tolist()
    rows = []
    for _, farm in farms.iterrows():
        latitude = farm["Latitude"] if farm["Latitude"] == farm["Latitude"] else 12.52
        rootzone, _ = rootzone_moisture(float(farm["Predicted_Soil_Moisture"]), reference, fc, wp, config)
        plan = irrigation_plan(
            FarmConditions(
                soil_moisture=rootzone,
                temperature_c=float(farm["Temperature_C"]),
                latitude=float(latitude),
                area_ha=float(farm["Farm_Area_ha"]),
                crop_age_days=crop_age,
                soil_type=soil_type,
                irrigation_method=method,
                pump_flow_m3h=pump_flow,
                start_date=start,
            ),
            config,
        )
        rec = plan["recommendation"]
        rows.append(
            {
                "Farm_ID": farm["Farm_ID"],
                "Taluk": farm["Taluk"],
                "Village": farm["Village"],
                "Status": rec["status"],
                "Next_Irrigation": rec["next_irrigation_date"],
                "Due_Day": rec["days_until_irrigation"],
                "Hours": rec["duration_hours"],
                "Volume_m3": rec["volume_m3"],
                "Stress_Index": plan["water_stress"]["stress_index"],
                "ETc_mm_day": plan["water_requirement"]["etc_mm_day"],
            }
        )
    return pd.DataFrame(rows)


def load_json(path: Path) -> dict | None:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


# --------------------------------------------------------------------- sidebar


def sidebar(farms: pd.DataFrame, cfg: dict) -> dict:
    st.sidebar.header("Farm")
    taluk = st.sidebar.selectbox("Taluk", ["All"] + sorted(farms["Taluk"].unique()))
    subset = farms if taluk == "All" else farms[farms["Taluk"] == taluk]
    village = st.sidebar.selectbox("Village", ["All"] + sorted(subset["Village"].unique()))
    subset = subset if village == "All" else subset[subset["Village"] == village]
    farm_id = st.sidebar.selectbox("Farm ID", subset["Farm_ID"].tolist())

    st.sidebar.header("Crop and equipment")
    today = date.today()
    planting = st.sidebar.date_input(
        "Planting or ratoon date", value=today - timedelta(days=180), max_value=today,
        help="The dataset has no planting date, so enter it here.",
    )
    soils = list(cfg["soils"])
    soil_type = st.sidebar.selectbox("Soil texture", soils, index=soils.index(cfg["default_soil"]))
    methods = list(cfg["irrigation_efficiency"])
    method = st.sidebar.selectbox("Irrigation method", methods, index=methods.index(cfg["default_method"]))
    pump_flow = st.sidebar.number_input(
        "Pump discharge (m³/h)", min_value=1.0, max_value=200.0, value=float(cfg["default_pump_flow_m3h"]), step=1.0
    )

    st.sidebar.header("Field sensor (optional)")
    use_sensor = st.sidebar.checkbox("I have a soil-moisture probe reading")
    sensor = None
    if use_sensor:
        sensor = st.sidebar.number_input(
            "Root-zone soil moisture (m³/m³)", min_value=0.0, max_value=0.6, value=0.20, step=0.005, format="%.3f"
        )

    st.sidebar.header("Advisory language")
    language = st.sidebar.selectbox("Language", list(LANGUAGES), format_func=lambda code: LANGUAGES[code])
    return {
        "farm_id": farm_id,
        "taluk": taluk,
        "village": village,
        "crop_age": max(0, (today - planting).days),
        "soil_type": soil_type,
        "method": method,
        "pump_flow": float(pump_flow),
        "sensor": sensor,
        "language": language,
        "start": today,
    }


def forecast_controls(farm: pd.Series, horizon: int) -> dict:
    """Manual forecast entry, or an opt-in Open-Meteo fetch for the farm centroid."""
    key = f"forecast_{farm['Farm_ID']}"
    with st.expander("Weather forecast input", expanded=False):
        st.caption(
            "No forecast is assumed by default. Enter expected daily rain, or fetch a live 14-day forecast "
            "from Open-Meteo. Fetching sends only the farm centroid coordinates."
        )
        manual = st.text_input("Daily rain for the next days (mm, comma separated)", value="", key=f"manual_{key}")
        if st.button("Fetch live forecast (Open-Meteo)", key=f"fetch_{key}"):
            from src.weather import fetch_forecast

            try:
                st.session_state[key] = fetch_forecast(float(farm["Latitude"]), float(farm["Longitude"]), horizon)
                st.success("Forecast loaded. ETo now uses FAO Penman-Monteith values from the forecast.")
            except Exception as error:  # network or API failure
                st.warning(f"Forecast unavailable ({type(error).__name__}). Using manual input instead.")
        if key in st.session_state:
            forecast = st.session_state[key]
            st.dataframe(pd.DataFrame(forecast), hide_index=True, width="stretch")
            if st.button("Clear live forecast", key=f"clear_{key}"):
                del st.session_state[key]
                st.rerun()
            return forecast
    if manual.strip():
        try:
            return {"rain_mm": [float(value) for value in manual.split(",") if value.strip()]}
        except ValueError:
            st.warning("Could not read the rain values. Use numbers separated by commas.")
    return {}


# ------------------------------------------------------------------- tab views


def farm_tab(farm: pd.Series, settings: dict, cfg: dict) -> None:
    forecast = forecast_controls(farm, int(cfg["forecast_horizon_days"]))
    result = farm_decision(
        farm,
        predicted_soil_moisture=float(farm["Predicted_Soil_Moisture"]),
        crop_age_days=settings["crop_age"],
        sensor_soil_moisture=settings["sensor"],
        soil_type=settings["soil_type"],
        irrigation_method=settings["method"],
        pump_flow_m3h=settings["pump_flow"],
        forecast=forecast,
        start_date=settings["start"],
        language=settings["language"],
        soil_moisture_reference=scored_farms()["Predicted_Soil_Moisture"].tolist(),
    )
    plan = result["plan"]
    rec = plan["recommendation"]
    style = STATUS_STYLE[rec["status"]]

    st.subheader(f"{style['icon']} {style['label']}")
    st.caption(
        f"Farm {farm['Farm_ID']} · {farm['Village']}, {farm['Taluk']} · {farm['Farm_Area_ha']:.2f} ha · "
        f"{plan['crop']['stage_label']} stage, day {settings['crop_age']}"
    )
    tiles = st.columns(5)
    tiles[0].metric("Soil moisture", f"{result['soil_moisture_used']:.1%}", SOURCE_LABEL[result["soil_moisture_source"]], delta_color="off")
    tiles[1].metric("Next irrigation", date.fromisoformat(rec["next_irrigation_date"]).strftime("%d %b"), f"in {rec['days_until_irrigation']} days", delta_color="off")
    tiles[2].metric("Pump duration", f"{rec['duration_hours']:.1f} h", f"{rec['volume_m3']:.0f} m³", delta_color="off")
    tiles[3].metric("Crop water use", f"{plan['water_requirement']['etc_mm_day']:.1f} mm/day", f"Kc {plan['crop']['kc']}", delta_color="off")
    tiles[4].metric("Water stress", plan["water_stress"]["category"].title(), f"index {plan['water_stress']['stress_index']:.2f}", delta_color="off")
    if result["soil_moisture_source"] == "ml_model":
        st.info(
            "Soil moisture is the ML model's estimate. The validation tab shows it does not generalise to unseen "
            "villages, so a field probe reading should replace it whenever available."
        )

    left, right = st.columns([1.1, 1])
    with left:
        st.markdown(f"**Advisory ({LANGUAGES[settings['language']]})**")
        text = result["advisory_text"]
        note = "Template advisory. Numbers come directly from the engine."
        if st.button("Rewrite with Claude (optional)"):
            generated = llm_advisory(result["facts"], settings["language"])
            text, note = generated["text"], generated["note"]
        st.success(text)
        st.caption(note)
        rain = plan["rainfall_adjustment"]
        if rain["postponed_days"]:
            st.write(f"Forecast rain of {rain['forecast_rain_mm']:.0f} mm postpones irrigation by {rain['postponed_days']} days.")
    with right:
        st.markdown("**Root-zone water balance, next 14 days**")
        projection = pd.DataFrame(plan["projection"])
        projection["date"] = pd.to_datetime(projection["date"])
        raw = plan["soil_water"]["raw_mm"]
        line = alt.Chart(projection).mark_line(strokeWidth=2, color="#2a78d6", point=alt.OverlayMarkDef(size=40, filled=True)).encode(
            x=alt.X("date:T", title=None, axis=alt.Axis(format="%d %b", grid=False)),
            y=alt.Y("depletion_start_mm:Q", title="Soil water depletion (mm)"),
            tooltip=[alt.Tooltip("date:T", format="%d %b"), alt.Tooltip("depletion_start_mm:Q", title="Depletion mm"),
                     alt.Tooltip("etc_mm:Q", title="ETc mm"), alt.Tooltip("rain_mm:Q", title="Rain mm"), alt.Tooltip("ks:Q", title="Ks")],
        )
        threshold = alt.Chart(pd.DataFrame({"raw": [raw]})).mark_rule(strokeDash=[4, 4], color="#8a8a8a").encode(y="raw:Q")
        label = alt.Chart(pd.DataFrame({"raw": [raw], "text": [f"Irrigate at {raw:.0f} mm (RAW)"]})).mark_text(
            align="left", dx=4, dy=-6, color="#5f5f5f"
        ).encode(y="raw:Q", text="text:N", x=alt.value(0))
        st.altair_chart((line + threshold + label).properties(height=250), width="stretch")
        st.caption(
            f"TAW {plan['soil_water']['taw_mm']:.0f} mm, root depth {plan['crop']['root_depth_m']} m, "
            f"ETo source: {plan['inputs']['eto_source']}."
        )

    col_loss, col_fert, col_pump = st.columns(3)
    with col_loss:
        st.markdown("**Yield loss if irrigation is delayed**")
        losses = pd.DataFrame(result["yield_loss_if_delayed"])[["delay_days", "relative_yield_loss_pct", "et_deficit_mm"]]
        losses.columns = ["Delay (days)", "Yield loss (%)", "ET deficit (mm)"]
        st.dataframe(losses, hide_index=True, width="stretch")
        st.caption("FAO-33 yield response (Ky). Relative estimate, not field-validated.")
    with col_fert:
        fert = result["fertigation"]
        st.markdown("**Fertigation with next irrigation**")
        products = pd.DataFrame(
            {"Product": list(fert["products_per_application_kg_acre"]),
             "kg per acre": list(fert["products_per_application_kg_acre"].values()),
             "kg for this plot": list(fert["products_per_application_kg_plot"].values())}
        )
        st.dataframe(products, hide_index=True, width="stretch")
        st.caption(
            f"{fert['applications_in_stage']} splits in this stage. Organic carbon rated {fert['organic_carbon_rating']}. "
            "Seasonal doses are placeholders for the KIAAR recommendation."
        )
    with col_pump:
        st.markdown("**Pump sessions in supply windows**")
        st.dataframe(pd.DataFrame(result["pump_sessions"]), hide_index=True, width="stretch")
        st.caption("Morning window first to cut evaporation losses.")

    st.markdown("**Human review**")
    with st.form(f"feedback_{farm['Farm_ID']}"):
        cols = st.columns([1, 1, 1, 2])
        role = cols[0].selectbox("Reviewer", ["field_officer", "agronomist", "farmer"])
        decision = cols[1].selectbox("Decision", ["accepted", "modified", "rejected"])
        override_hours = cols[2].number_input("Override hours", min_value=0.0, value=float(rec["duration_hours"]), step=0.5)
        comment = cols[3].text_input("Comment")
        if st.form_submit_button("Record decision"):
            log_feedback(
                {
                    "farm_id": str(farm["Farm_ID"]),
                    "reviewer_role": role,
                    "decision": decision,
                    "recommended_date": rec["next_irrigation_date"],
                    "recommended_hours": rec["duration_hours"],
                    "override_hours": override_hours if decision == "modified" else None,
                    "comment": comment or None,
                    "soil_moisture_source": result["soil_moisture_source"],
                }
            )
            st.success("Decision recorded. These records become labels for future model training.")
    history = [row for row in read_feedback() if row["farm_id"] == str(farm["Farm_ID"])]
    if history:
        st.dataframe(pd.DataFrame(history), hide_index=True, width="stretch")


def render_map(farms: pd.DataFrame, plans: pd.DataFrame) -> None:
    try:
        import folium
        from streamlit_folium import st_folium
    except ImportError:
        st.warning("Install folium and streamlit-folium to see the map.")
        return
    merged = farms.merge(plans[["Farm_ID", "Status", "Next_Irrigation", "Hours"]], on="Farm_ID")
    merged = merged[merged[".geo"].map(parse_geometry).notna()]
    if merged.empty:
        st.info("No valid farm polygons in this selection.")
        return
    farm_map = folium.Map(location=[merged["Latitude"].mean(), merged["Longitude"].mean()], zoom_start=11, control_scale=True)
    for _, farm in merged.iterrows():
        style = STATUS_STYLE[farm["Status"]]
        tooltip = (
            f"<b>{farm['Farm_ID']}</b><br>{farm['Village']}, {farm['Taluk']}<br>"
            f"{style['label']}<br>Next irrigation: {farm['Next_Irrigation']}<br>"
            f"Pump hours: {farm['Hours']:.1f}<br>Model soil moisture: {farm['Predicted_Soil_Moisture']:.1%}"
        )
        folium.GeoJson(
            parse_geometry(farm[".geo"]),
            style_function=lambda _f, fill=style["color"]: {"fillColor": fill, "color": fill, "weight": 1, "fillOpacity": 0.55},
            tooltip=folium.Tooltip(tooltip),
        ).add_to(farm_map)
    st_folium(farm_map, height=520, use_container_width=True, returned_objects=[])
    st.caption("  ".join(f"{s['icon']} {s['label']}" for s in STATUS_STYLE.values()))


def fleet_tab(farms: pd.DataFrame, plans: pd.DataFrame, settings: dict) -> None:
    selection = plans
    if settings["taluk"] != "All":
        selection = selection[selection["Taluk"] == settings["taluk"]]
    if settings["village"] != "All":
        selection = selection[selection["Village"] == settings["village"]]
    counts = selection["Status"].value_counts()
    tiles = st.columns(5)
    tiles[0].metric("Farms", f"{len(selection):,}")
    for column, status in zip(tiles[1:4], STATUS_STYLE):
        column.metric(f"{STATUS_STYLE[status]['icon']} {STATUS_STYLE[status]['label']}", int(counts.get(status, 0)))
    tiles[4].metric("Water due in 7 days", f"{selection.loc[selection['Due_Day'] <= 7, 'Volume_m3'].sum():,.0f} m³")
    st.caption(
        f"All farms use the sidebar crop age ({settings['crop_age']} days), soil and equipment, and the ML soil-moisture "
        "estimate. Real deployment would read each plot's planting date from STEPS."
    )
    render_map(farms[farms["Farm_ID"].isin(selection["Farm_ID"])], selection)

    st.markdown("**Farms by days until irrigation**")
    due = selection.groupby("Due_Day").size().reset_index(name="Farms")
    chart = alt.Chart(due).mark_bar(color="#2a78d6", cornerRadiusTopLeft=4, cornerRadiusTopRight=4).encode(
        x=alt.X("Due_Day:O", title="Days until irrigation is due"),
        y=alt.Y("Farms:Q", title="Farms"),
        tooltip=["Due_Day", "Farms"],
    )
    st.altair_chart(chart.properties(height=220), width="stretch")
    st.dataframe(selection.sort_values(["Due_Day", "Stress_Index"], ascending=[True, False]), hide_index=True, width="stretch")


def scheduling_tab(plans: pd.DataFrame, settings: dict, cfg_full: dict) -> None:
    villages = sorted(plans["Village"].unique())
    default = villages.index(settings["village"]) if settings["village"] in villages else 0
    village = st.selectbox("Feeder (village)", villages, index=default)
    cols = st.columns(3)
    capacity = cols[0].number_input(
        "Max pumps running at once", min_value=1, max_value=500,
        value=int(cfg_full["pump_scheduling"]["max_concurrent_pumps_per_feeder"]),
    )
    days = cols[1].slider("Planning horizon (days)", 3, 30, 21)
    windows = ", ".join(f"{w['start']}-{w['end']}" for w in cfg_full["pump_scheduling"]["supply_windows"])
    cols[2].markdown(f"**Supply windows**  \n{windows}")

    farms = plans[(plans["Village"] == village) & (plans["Due_Day"] < days)]
    if farms.empty:
        st.info("No farm in this village is due for irrigation inside the planning horizon.")
        return
    request = [
        {"farm_id": row.Farm_ID, "hours": float(row.Hours), "due_day": int(row.Due_Day), "stress_index": float(row.Stress_Index)}
        for row in farms.itertuples()
    ]
    result = schedule_feeder(request, settings["start"], days=days, max_concurrent=int(capacity))
    fully = len(request) - len(result["unscheduled"])
    tiles = st.columns(5)
    tiles[0].metric("Farms due", len(request))
    tiles[1].metric("Fully scheduled", fully)
    tiles[2].metric("Pump-hours unmet", f"{result['unmet_hours']:,.0f} of {result['demand_hours']:,.0f}")
    tiles[3].metric("Peak pumps running", result["peak_concurrent_pumps"])
    tiles[4].metric("Feeder utilisation", f"{result['feeder_utilisation']:.0%}")
    st.caption(result["method_note"])
    if result["unscheduled"]:
        st.warning(
            f"{len(result['unscheduled'])} farms cannot finish pumping inside the horizon. Raise feeder capacity, "
            "extend the horizon, or switch to a more efficient irrigation method."
        )
        st.dataframe(pd.DataFrame(result["unscheduled"]), hide_index=True, width="stretch")
    if not result["assignments"]:
        return

    schedule = pd.DataFrame(result["assignments"])
    schedule["start_dt"] = pd.to_datetime(schedule["date"] + " " + schedule["start"])
    schedule["end_dt"] = schedule["start_dt"] + pd.to_timedelta(schedule["hours"], unit="h")
    shown = schedule[schedule["farm_id"].isin(schedule["farm_id"].unique()[:40])]
    gantt = alt.Chart(shown).mark_bar(color="#2a78d6", cornerRadius=2, height=8).encode(
        x=alt.X("start_dt:T", title=None, axis=alt.Axis(format="%d %b %H:%M")),
        x2="end_dt:T",
        y=alt.Y("farm_id:N", title=None, sort=list(shown["farm_id"].unique())),
        tooltip=["farm_id", "date", "start", "end", "hours"],
    )
    st.altair_chart(gantt.properties(height=max(200, 14 * shown["farm_id"].nunique())), width="stretch")
    if shown["farm_id"].nunique() < schedule["farm_id"].nunique():
        st.caption("Chart shows the first 40 farms in priority order; the table lists all.")
    st.dataframe(schedule[["farm_id", "date", "start", "end", "hours"]], hide_index=True, width="stretch")


def model_tab(farm: pd.Series) -> None:
    artifact = get_artifact()
    metadata = artifact["metadata"]
    result = predict_record(artifact, farm, farm_id=str(farm["Farm_ID"]))
    advisory = result["advisory"]
    tiles = st.columns(4)
    tiles[0].metric("Predicted soil moisture", f"{advisory['predicted_soil_moisture']:.2%}")
    tiles[1].metric("Prototype risk", advisory["risk_level"])
    tiles[2].metric("Model", metadata["model_name"])
    tiles[3].metric("Random-split test R²", f"{metadata['test_metrics']['r2']:.3f}")
    st.caption(advisory["threshold_note"])

    st.markdown("**Local explanation**")
    st.caption("One-at-a-time baseline replacement. Shows sensitivity, not causation.")
    contributions = pd.DataFrame(result["explanation"]["contributions"]).head(8)
    if not contributions.empty:
        bars = alt.Chart(contributions).mark_bar(color="#2a78d6", cornerRadius=3).encode(
            x=alt.X("contribution:Q", title="Change in predicted soil moisture vs baseline"),
            y=alt.Y("feature:N", sort="-x", title=None),
            tooltip=["feature", alt.Tooltip("contribution:Q", format=".6f")],
        )
        st.altair_chart(bars.properties(height=240), width="stretch")

    st.markdown("**What-if simulator**")
    controls = st.columns(3)
    rainfall = controls[0].number_input("Rainfall (mm)", min_value=0.0, value=float(farm["Rainfall_mm"]), step=1.0)
    temperature = controls[1].number_input("Temperature (°C)", value=float(farm["Temperature_C"]), step=0.1)
    humidity = controls[2].number_input("Relative humidity (%)", min_value=0.0, max_value=100.0, value=float(farm["Relative_Humidity"]), step=0.1)
    if st.button("Run what-if simulation", type="primary"):
        simulation = what_if(artifact, farm, {"Rainfall_mm": rainfall, "Temperature_C": temperature, "Relative_Humidity": humidity})
        original = simulation["original"]["advisory"]
        changed = simulation["simulated"]["advisory"]
        before, after = st.columns(2)
        before.metric("Original", f"{original['predicted_soil_moisture']:.2%}", original["risk_level"], delta_color="off")
        after.metric("What-if", f"{changed['predicted_soil_moisture']:.2%}", f"{simulation['prediction_change']:+.4f}")
        st.info(simulation["simulation_note"])


def validation_tab() -> None:
    summary = load_json(REPORTS / "spatial_validation_summary.json")
    results_path = REPORTS / "spatial_validation.csv"
    if summary is None or not results_path.exists():
        st.warning("Run `python -m src.validation` to generate the spatial validation report.")
        return
    st.markdown(f"**Finding.** {summary['finding']}")
    profile = summary["target_profile"]
    tiles = st.columns(3)
    tiles[0].metric("Distinct soil-moisture values", profile["distinct_target_values"])
    tiles[1].metric("Villages with one value only", f"{profile['villages_with_single_target_value']} of {profile['villages']}")
    tiles[2].metric("Unseen-village baseline MAE", f"{summary['unseen_village_mean_baseline_mae']:.4f}")
    figure = REPORTS / "figures" / "spatial_validation.png"
    if figure.exists():
        st.image(str(figure), width=720)
    results = pd.read_csv(results_path)
    st.dataframe(results.style.format({"mae": "{:.5f}", "rmse": "{:.5f}", "r2": "{:.3f}"}), hide_index=True, width="stretch")
    st.caption(
        "A negative R² means the model is worse than predicting the average. Random splits leak village-level "
        "values between train and test; leave-one-village-out is the honest deployment test."
    )


def coverage_tab() -> None:
    st.markdown("**AI models requested in KJS-AGR-01**")
    table = pd.DataFrame(AI_MODELS)
    table.columns = ["Use-case model", "Status", "Implementation", "Evidence", "Limitation"]
    st.dataframe(table, hide_index=True, width="stretch")
    st.caption(
        "ML model: trained on supplied labels. Rule-based: FAO equations, because no labels exist. Implemented: built as requested. "
        "Partial: a proxy for the requested output. Blocked: needs data the dataset lacks."
    )
    st.markdown("**Workflow stages covered**")
    st.dataframe(pd.DataFrame(WORKFLOW_STAGES, columns=["Stage", "What this prototype provides"]), hide_index=True, width="stretch")


# ------------------------------------------------------------------------ main


def main() -> None:
    st.title("💧 Sugarcane irrigation advisory")
    st.caption(
        "KJS-AGR-01 prototype. Soil moisture comes from a field sensor or an ML estimate; irrigation timing, "
        "depth, stress, yield loss and fertigation come from FAO-56/FAO-33 equations with prototype parameters. "
        "Nothing here is an agronomically validated prescription."
    )
    if not DEFAULT_MODEL_PATH.exists():
        st.error("No saved model is available. Run `python -m src.train` from the project root first.")
        st.stop()

    config = load_config()
    cfg = config["agronomy"]
    farms = scored_farms()
    settings = sidebar(farms, cfg)
    farm = farms.loc[farms["Farm_ID"] == settings["farm_id"]].iloc[0]
    plans = fleet_plans(settings["crop_age"], settings["soil_type"], settings["method"], settings["pump_flow"], settings["start"])

    tabs = st.tabs(["Farm advisory", "Fleet map", "Pump scheduling", "Soil-moisture model", "Model validation", "Use-case coverage"])
    with tabs[0]:
        farm_tab(farm, settings, cfg)
    with tabs[1]:
        fleet_tab(farms, plans, settings)
    with tabs[2]:
        scheduling_tab(plans, settings, config)
    with tabs[3]:
        model_tab(farm)
    with tabs[4]:
        validation_tab()
    with tabs[5]:
        coverage_tab()


if __name__ == "__main__":
    main()
