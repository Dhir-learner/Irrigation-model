"""Cached farm tables shared by the API and the web frontend."""

from __future__ import annotations

import math
from datetime import date
from functools import lru_cache
from typing import Any

import pandas as pd

from src.advisory import load_config, risk_level
from src.agronomy import FarmConditions, irrigation_plan
from src.data_loader import DEFAULT_DATA_PATH, load_data
from src.features import geometry_center
from src.predict import load_artifact, predict_batch

DISTRICT_LATITUDE = 12.52  # Mandya, used only when a plot has no valid polygon


def clean(value: Any) -> Any:
    """Make pandas/numpy values JSON-safe (NaN becomes None)."""
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    if hasattr(value, "item"):
        value = value.item()
        if isinstance(value, float) and math.isnan(value):
            return None
    return value


@lru_cache(maxsize=4)
def farm_table(model_path: str) -> pd.DataFrame:
    """All farms with the saved model's soil-moisture estimate and plot centroids."""
    farms = load_data(DEFAULT_DATA_PATH).copy()
    farms["Predicted_Soil_Moisture"] = predict_batch(load_artifact(model_path), farms)
    config = load_config()
    farms["Risk_Level"] = farms["Predicted_Soil_Moisture"].map(lambda value: risk_level(float(value), config))
    centers = farms[".geo"].map(geometry_center)
    farms["Longitude"] = centers.map(lambda pair: pair[0])
    farms["Latitude"] = centers.map(lambda pair: pair[1])
    return farms


def farm_row(model_path: str, farm_id: str) -> pd.Series | None:
    farms = farm_table(model_path)
    match = farms[farms["Farm_ID"] == farm_id]
    return None if match.empty else match.iloc[0]


@lru_cache(maxsize=32)
def fleet_status(
    model_path: str, crop_age: int, soil_type: str, method: str, pump_flow: float, start_iso: str
) -> list[dict[str, Any]]:
    """FAO-56 plan summary for every farm under shared crop and equipment settings."""
    start = date.fromisoformat(start_iso)
    rows = []
    for _, farm in farm_table(model_path).iterrows():
        latitude = farm["Latitude"] if farm["Latitude"] == farm["Latitude"] else DISTRICT_LATITUDE
        plan = irrigation_plan(
            FarmConditions(
                soil_moisture=float(farm["Predicted_Soil_Moisture"]),
                temperature_c=float(farm["Temperature_C"]),
                latitude=float(latitude),
                area_ha=float(farm["Farm_Area_ha"]),
                crop_age_days=crop_age,
                soil_type=soil_type,
                irrigation_method=method,
                pump_flow_m3h=pump_flow,
                start_date=start,
            )
        )
        rec = plan["recommendation"]
        rows.append(
            {
                "farm_id": farm["Farm_ID"],
                "taluk": farm["Taluk"],
                "village": farm["Village"],
                "status": rec["status"],
                "next_irrigation_date": rec["next_irrigation_date"],
                "due_day": rec["days_until_irrigation"],
                "hours": rec["duration_hours"],
                "volume_m3": rec["volume_m3"],
                "stress_index": plan["water_stress"]["stress_index"],
                "soil_moisture": round(float(farm["Predicted_Soil_Moisture"]), 4),
            }
        )
    return rows
