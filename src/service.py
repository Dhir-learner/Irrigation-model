"""Cached farm tables shared by the API and the web frontend."""

from __future__ import annotations

import math
from datetime import date, timedelta
from functools import lru_cache
from typing import Any

import numpy as np
import pandas as pd

from src.advisory import load_config, risk_level
from src.agronomy import FarmConditions, agronomy_config, irrigation_plan, soil_properties
from src.calibration import percentile_rank, rootzone_moisture
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


def soil_moisture_reference(model_path: str) -> tuple[float, ...]:
    """The fleet's model soil-moisture distribution, used to calibrate single-farm estimates."""
    return tuple(float(value) for value in farm_table(model_path)["Predicted_Soil_Moisture"])


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
    config = load_config()
    _, fc, wp = soil_properties(agronomy_config(config), soil_type)
    reference = soil_moisture_reference(model_path)
    rows = []
    for _, farm in farm_table(model_path).iterrows():
        latitude = farm["Latitude"] if farm["Latitude"] == farm["Latitude"] else DISTRICT_LATITUDE
        rootzone, calibration = rootzone_moisture(
            float(farm["Predicted_Soil_Moisture"]), reference, fc, wp, config
        )
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
                "rootzone_moisture": round(rootzone, 4),
                "relative_wetness": calibration.get("relative_wetness"),
                "depletion_ratio": plan["soil_water"]["depletion_ratio"],
                "etc_mm_day": plan["water_requirement"]["etc_mm_day"],
                "area_ha": round(float(farm["Farm_Area_ha"]), 4),
                "latitude": clean(farm["Latitude"]),
                "longitude": clean(farm["Longitude"]),
            }
        )
    return rows


def wetness_percentile(model_path: str, value: float) -> float:
    return percentile_rank(value, soil_moisture_reference(model_path))


ANALYTIC_FEATURES = [
    "Predicted_Soil_Moisture", "NDVI", "LAI", "Rainfall_mm", "Temperature_C",
    "Relative_Humidity", "Organic_Carbon", "Soil_pH",
]


def fleet_analytics(
    model_path: str, crop_age: int, soil_type: str, method: str, pump_flow: float, start_iso: str
) -> dict[str, Any]:
    """Portfolio-level statistics for the analytics view.

    * per-village summary (status mix, moisture, water and pump-hour demand)
    * a 14-day irrigation demand calendar: gross volume falling due each day
    * feature distributions and Pearson / Spearman correlation with soil moisture
    """
    fleet = pd.DataFrame(fleet_status(model_path, crop_age, soil_type, method, pump_flow, start_iso))
    table = farm_table(model_path)
    start = date.fromisoformat(start_iso)
    horizon = int(agronomy_config()["forecast_horizon_days"])

    def status_count(frame: pd.DataFrame, status: str) -> int:
        return int((frame["status"] == status).sum())

    villages = []
    for (taluk, village), group in fleet.groupby(["taluk", "village"], sort=True):
        due_week = group[group["due_day"] <= 7]
        villages.append(
            {
                "taluk": taluk,
                "village": village,
                "farms": int(len(group)),
                "irrigate_now": status_count(group, "IRRIGATE_NOW"),
                "irrigate_soon": status_count(group, "IRRIGATE_SOON"),
                "not_required": status_count(group, "NOT_REQUIRED"),
                "mean_soil_moisture": round(float(group["soil_moisture"].mean()), 4),
                "mean_relative_wetness": clean(round(float(group["relative_wetness"].mean()), 3))
                if group["relative_wetness"].notna().any()
                else None,
                "mean_due_day": round(float(group["due_day"].mean()), 1),
                "volume_due_7d_m3": round(float(due_week["volume_m3"].sum()), 0),
                "pump_hours_due_7d": round(float(due_week["hours"].sum()), 1),
                "area_ha": round(float(group["area_ha"].sum()), 2),
            }
        )

    calendar = []
    for day in range(horizon):
        due = fleet[fleet["due_day"] == day]
        calendar.append(
            {
                "date": (start + timedelta(days=day)).isoformat(),
                "day": day,
                "farms_due": int(len(due)),
                "volume_m3": round(float(due["volume_m3"].sum()), 0),
                "pump_hours": round(float(due["hours"].sum()), 1),
            }
        )
    beyond = fleet[fleet["due_day"] >= horizon]

    numeric = table[ANALYTIC_FEATURES].apply(pd.to_numeric, errors="coerce")
    pearson = numeric.corr(method="pearson")["Predicted_Soil_Moisture"].drop("Predicted_Soil_Moisture")
    spearman = numeric.corr(method="spearman")["Predicted_Soil_Moisture"].drop("Predicted_Soil_Moisture")
    correlations = [
        {"feature": name, "pearson": clean(round(float(pearson[name]), 3)), "spearman": clean(round(float(spearman[name]), 3))}
        for name in pearson.index
    ]
    correlations.sort(key=lambda row: -abs(row["spearman"] or 0))

    def histogram(values: pd.Series, bins: int = 20) -> list[dict[str, Any]]:
        values = values.dropna().astype(float)
        if values.empty:
            return []
        counts, edges = np.histogram(values, bins=bins)
        return [
            {"from": round(float(edges[i]), 4), "to": round(float(edges[i + 1]), 4), "count": int(counts[i])}
            for i in range(len(counts))
        ]

    describe = {}
    for name in ANALYTIC_FEATURES:
        column = numeric[name].dropna()
        describe[name] = {
            "mean": round(float(column.mean()), 4),
            "std": round(float(column.std()), 4),
            "min": round(float(column.min()), 4),
            "p25": round(float(column.quantile(0.25)), 4),
            "median": round(float(column.median()), 4),
            "p75": round(float(column.quantile(0.75)), 4),
            "max": round(float(column.max()), 4),
            "cv": round(float(column.std() / column.mean()), 4) if column.mean() else None,
            "missing": int(numeric[name].isna().sum()),
        }

    totals = {
        "farms": int(len(fleet)),
        "area_ha": round(float(fleet["area_ha"].sum()), 1),
        "irrigate_now": status_count(fleet, "IRRIGATE_NOW"),
        "irrigate_soon": status_count(fleet, "IRRIGATE_SOON"),
        "not_required": status_count(fleet, "NOT_REQUIRED"),
        "volume_due_7d_m3": round(float(fleet.loc[fleet["due_day"] <= 7, "volume_m3"].sum()), 0),
        "pump_hours_due_7d": round(float(fleet.loc[fleet["due_day"] <= 7, "hours"].sum()), 1),
        "mean_etc_mm_day": round(float(fleet["etc_mm_day"].mean()), 2),
        "daily_etc_m3": round(float((fleet["etc_mm_day"] * fleet["area_ha"] * 10).sum()), 0),
        "farms_due_beyond_horizon": int(len(beyond)),
    }
    return {
        "settings": {"crop_age_days": crop_age, "soil_type": soil_type, "irrigation_method": method, "pump_flow_m3h": pump_flow},
        "totals": totals,
        "villages": villages,
        "demand_calendar": calendar,
        "correlations": correlations,
        "soil_moisture_histogram": histogram(table["Predicted_Soil_Moisture"]),
        "feature_summary": describe,
    }


def feature_ranges(model_path: str) -> dict[str, dict[str, float]]:
    """Observed min / median / max of each numeric model input, for what-if sliders."""
    table = farm_table(model_path)
    ranges = {}
    for name in ["Rainfall_mm", "Temperature_C", "Relative_Humidity", "NDVI", "LAI", "Organic_Carbon", "Soil_pH"]:
        column = pd.to_numeric(table[name], errors="coerce").dropna()
        ranges[name] = {
            "min": round(float(column.min()), 4),
            "median": round(float(column.median()), 4),
            "max": round(float(column.max()), 4),
        }
    return ranges
