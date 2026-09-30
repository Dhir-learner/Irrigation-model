"""FastAPI endpoints served from the persisted model artifact."""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

import json

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from src.database import (
    DEFAULT_DB_PATH,
    initialize_database,
    initialize_feedback_table,
    log_feedback,
    log_prediction,
    read_feedback,
)
from src.advisory import load_config
from src.coverage import AI_MODELS, WORKFLOW_STAGES
from src.decision import farm_decision
from src.features import parse_geometry
from src.service import clean, farm_row, farm_table, fleet_status
from src.multilingual import LANGUAGES, llm_advisory, template_advisory
from src.predict import load_artifact, predict_record, what_if
from src.scheduling import schedule_feeder
from src.train import DEFAULT_MODEL_PATH


PROJECT_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_DIR = PROJECT_ROOT / "frontend"
REPORTS_DIR = PROJECT_ROOT / "reports"
MODEL_PATH = DEFAULT_MODEL_PATH
DB_PATH = DEFAULT_DB_PATH


@asynccontextmanager
async def lifespan(_app: FastAPI):
    initialize_database(DB_PATH)
    initialize_feedback_table(DB_PATH)
    yield


app = FastAPI(
    title="AI Irrigation Advisory API",
    version="0.2.0",
    lifespan=lifespan,
    description=(
        "Prototype soil-moisture prediction, FAO-56 irrigation planning, pump scheduling, "
        "multilingual advisories and human-in-the-loop feedback. Irrigation quantities are "
        "rule-based estimates with prototype parameters, not validated prescriptions."
    ),
)


class PredictionInput(BaseModel):
    farm_id: str = Field(default="API-input", description="Farm identifier used in the advisory log.")
    LAI: float | None = None
    NDVI: float | None = None
    Organic_Carbon: float | None = None
    Rainfall_mm: float | None = None
    Relative_Humidity: float | None = None
    Soil_pH: float | None = None
    Temperature_C: float | None = None
    Taluk: str | None = None
    Village: str | None = None
    geometry: str | dict[str, Any] | None = Field(
        default=None, description="Optional valid GeoJSON geometry; omitted geometry is imputed by the model."
    )


class WhatIfRequest(BaseModel):
    farm_id: str = "API-input"
    features: dict[str, Any]
    changes: dict[str, Any]


@lru_cache(maxsize=1)
def _artifact() -> dict[str, Any]:
    try:
        return load_artifact(MODEL_PATH)
    except FileNotFoundError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


def _model_input(payload: PredictionInput) -> dict[str, Any]:
    data = payload.model_dump(exclude_none=True)
    data["Farm_ID"] = data.pop("farm_id")
    return data


@app.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "model_available": Path(MODEL_PATH).exists()}


@app.post("/predict")
def predict(payload: PredictionInput) -> dict[str, Any]:
    input_features = _model_input(payload)
    result = predict_record(_artifact(), input_features, farm_id=payload.farm_id)
    advisory = result["advisory"]
    log_prediction(advisory, input_features, result["model_name"], path=DB_PATH)
    return {
        "prediction": advisory["predicted_soil_moisture"],
        "risk_level": advisory["risk_level"],
        "advisory": advisory,
        "explanation": result["explanation"],
        "model_name": result["model_name"],
    }


@app.post("/what-if")
def simulate(payload: WhatIfRequest) -> dict[str, Any]:
    features = dict(payload.features)
    features["Farm_ID"] = payload.farm_id
    result = what_if(_artifact(), features, payload.changes)
    advisory = result["simulated"]["advisory"]
    log_prediction(advisory, {"features": features, "changes": payload.changes}, result["simulated"]["model_name"], "what_if", DB_PATH)
    return result


@app.get("/model-info")
def model_info() -> dict[str, Any]:
    metadata = _artifact()["metadata"]
    return {
        "model_name": metadata["model_name"],
        "target": metadata["target"],
        "training_date": metadata["trained_at"],
        "feature_list": metadata["raw_feature_columns"],
        "test_metrics": metadata["test_metrics"],
        "split_strategy": metadata["split_strategy"],
    }


class IrrigationPlanRequest(PredictionInput):
    crop_age_days: int = Field(ge=0, le=500, description="Days since planting or ratoon.")
    sensor_soil_moisture: float | None = Field(
        default=None, ge=0, le=1, description="In-field probe reading (m3/m3). Overrides the model when given."
    )
    Farm_Area_ha: float | None = Field(default=None, gt=0)
    soil_type: str | None = None
    irrigation_method: str | None = None
    pump_flow_m3h: float | None = Field(default=None, gt=0)
    forecast_rain_mm: list[float] = Field(default_factory=list, description="Daily forecast rain from today.")
    forecast_temperature_c: list[float] = Field(default_factory=list)
    start_date: date | None = None
    language: Literal["en", "kn", "hi", "mr"] = "en"


class FeederFarm(BaseModel):
    farm_id: str
    hours: float = Field(gt=0)
    due_day: int = Field(ge=0)
    stress_index: float = 0.0


class FeederRequest(BaseModel):
    farms: list[FeederFarm]
    start_date: date | None = None
    days: int = Field(default=7, ge=1, le=21)
    max_concurrent: int | None = Field(default=None, ge=1)


class AdvisoryRequest(BaseModel):
    facts: dict[str, Any]
    language: Literal["en", "kn", "hi", "mr"] = "en"
    use_llm: bool = False


class FeedbackRequest(BaseModel):
    farm_id: str
    decision: Literal["accepted", "modified", "rejected"]
    reviewer_role: Literal["farmer", "field_officer", "agronomist"] = "field_officer"
    recommended_date: str | None = None
    recommended_hours: float | None = None
    override_date: str | None = None
    override_hours: float | None = None
    comment: str | None = Field(default=None, max_length=1000)
    soil_moisture_source: str | None = None


@app.post("/irrigation-plan")
def irrigation_plan_endpoint(payload: IrrigationPlanRequest) -> dict[str, Any]:
    """FAO-56 irrigation plan, fertigation, yield-loss table, pump sessions and advisory text."""
    features = _model_input(payload)
    predicted = None
    if payload.sensor_soil_moisture is None:
        predicted = predict_record(_artifact(), features, farm_id=payload.farm_id)["advisory"]["predicted_soil_moisture"]
    record = {**features, ".geo": features.get("geometry"), "Farm_Area_ha": payload.Farm_Area_ha or 1.0}
    forecast = {"rain_mm": payload.forecast_rain_mm, "temperature_c": payload.forecast_temperature_c}
    return farm_decision(
        record,
        predicted_soil_moisture=predicted,
        crop_age_days=payload.crop_age_days,
        sensor_soil_moisture=payload.sensor_soil_moisture,
        soil_type=payload.soil_type,
        irrigation_method=payload.irrigation_method,
        pump_flow_m3h=payload.pump_flow_m3h,
        forecast=forecast,
        start_date=payload.start_date,
        language=payload.language,
    )


@app.post("/feeder-schedule")
def feeder_schedule(payload: FeederRequest) -> dict[str, Any]:
    """Allocate pumping slots for farms sharing one electricity feeder."""
    return schedule_feeder(
        [farm.model_dump() for farm in payload.farms],
        payload.start_date or date.today(),
        days=payload.days,
        max_concurrent=payload.max_concurrent,
    )


@app.post("/advisory")
def advisory(payload: AdvisoryRequest) -> dict[str, Any]:
    """Render advisory facts (from /irrigation-plan) in English, Kannada, Hindi or Marathi."""
    if payload.use_llm:
        return {"language": LANGUAGES[payload.language], **llm_advisory(payload.facts, payload.language)}
    try:
        text = template_advisory(payload.facts, payload.language)
    except KeyError as error:
        raise HTTPException(status_code=422, detail=f"Missing advisory fact: {error}") from error
    return {"language": LANGUAGES[payload.language], "text": text, "source": "template"}


@app.post("/feedback")
def feedback(payload: FeedbackRequest) -> dict[str, Any]:
    """Record whether a human accepted, modified or rejected an advisory."""
    entry_id = log_feedback(payload.model_dump(), DB_PATH)
    return {"id": entry_id, "status": "recorded"}


@app.get("/feedback")
def feedback_list(limit: int = 50) -> list[dict[str, Any]]:
    return read_feedback(DB_PATH, limit)


# --------------------------------------------------------------------------
# Endpoints used by the web frontend (frontend/, served at /app)
# --------------------------------------------------------------------------

FARM_FIELDS = [
    "Farm_ID", "District", "Taluk", "Village", "Farm_Area_ha", "NDVI", "LAI", "Soil_pH",
    "Organic_Carbon", "Rainfall_mm", "Temperature_C", "Relative_Humidity",
]


def _farm_or_404(farm_id: str) -> pd.Series:
    _artifact()  # 503 when no model is trained
    farm = farm_row(str(MODEL_PATH), farm_id)
    if farm is None:
        raise HTTPException(status_code=404, detail=f"Unknown farm: {farm_id}")
    return farm


@app.get("/options")
def options() -> dict[str, Any]:
    """Choices and defaults the frontend needs to build its forms."""
    config = load_config()
    agronomy = config["agronomy"]
    return {
        "soils": list(agronomy["soils"]),
        "default_soil": agronomy["default_soil"],
        "methods": {name: value for name, value in agronomy["irrigation_efficiency"].items()},
        "default_method": agronomy["default_method"],
        "default_pump_flow_m3h": agronomy["default_pump_flow_m3h"],
        "languages": LANGUAGES,
        "supply_windows": config["pump_scheduling"]["supply_windows"],
        "max_concurrent_pumps_per_feeder": config["pump_scheduling"]["max_concurrent_pumps_per_feeder"],
        "stage_days": agronomy["stage_days"],
    }


@app.get("/farms")
def farms() -> list[dict[str, Any]]:
    """Lightweight list of every farm for selectors."""
    _artifact()
    table = farm_table(str(MODEL_PATH))
    return [
        {
            "farm_id": row.Farm_ID,
            "taluk": row.Taluk,
            "village": row.Village,
            "area_ha": round(float(row.Farm_Area_ha), 3),
            "latitude": clean(row.Latitude),
            "longitude": clean(row.Longitude),
            "soil_moisture": round(float(row.Predicted_Soil_Moisture), 4),
        }
        for row in table.itertuples()
    ]


@app.get("/farms/geojson")
def farms_geojson(village: str | None = None, taluk: str | None = None) -> dict[str, Any]:
    """Plot polygons as a GeoJSON FeatureCollection, optionally filtered."""
    _artifact()
    table = farm_table(str(MODEL_PATH))
    if taluk:
        table = table[table["Taluk"] == taluk]
    if village:
        table = table[table["Village"] == village]
    features = []
    for farm_id, village_name, taluk_name, raw_geometry in zip(
        table["Farm_ID"], table["Village"], table["Taluk"], table[".geo"]
    ):
        geometry = parse_geometry(raw_geometry)
        if geometry is None:
            continue
        features.append(
            {
                "type": "Feature",
                "geometry": geometry,
                "properties": {"farm_id": farm_id, "village": village_name, "taluk": taluk_name},
            }
        )
    return {"type": "FeatureCollection", "features": features}


@app.get("/farms/{farm_id}")
def farm_detail(farm_id: str) -> dict[str, Any]:
    """One farm's recorded fields, its model estimate and the local explanation."""
    farm = _farm_or_404(farm_id)
    result = predict_record(_artifact(), farm, farm_id=farm_id)
    return {
        "farm": {field: clean(farm[field]) for field in FARM_FIELDS},
        "latitude": clean(farm["Latitude"]),
        "longitude": clean(farm["Longitude"]),
        "geometry": parse_geometry(farm[".geo"]),
        "model": {
            "predicted_soil_moisture": result["advisory"]["predicted_soil_moisture"],
            "risk_level": result["advisory"]["risk_level"],
            "model_name": result["model_name"],
            "top_factors": result["explanation"]["contributions"][:6],
        },
    }


class FarmPlanRequest(BaseModel):
    crop_age_days: int = Field(ge=0, le=500)
    sensor_soil_moisture: float | None = Field(default=None, ge=0, le=0.6)
    soil_type: str | None = None
    irrigation_method: str | None = None
    pump_flow_m3h: float | None = Field(default=None, gt=0)
    forecast_rain_mm: list[float] = Field(default_factory=list)
    use_live_weather: bool = False
    language: Literal["en", "kn", "hi", "mr"] = "en"


@app.post("/farms/{farm_id}/plan")
def farm_plan(farm_id: str, payload: FarmPlanRequest) -> dict[str, Any]:
    """Full advisory bundle for a farm, optionally with a live Open-Meteo forecast."""
    farm = _farm_or_404(farm_id)
    forecast: dict[str, Any] = {"rain_mm": payload.forecast_rain_mm} if payload.forecast_rain_mm else {}
    weather_note = "manual rain input" if forecast else "no forecast: dry-weather projection"
    if payload.use_live_weather and farm["Latitude"] == farm["Latitude"]:
        from src.weather import fetch_forecast

        try:
            forecast = fetch_forecast(float(farm["Latitude"]), float(farm["Longitude"]), 14)
            weather_note = "live Open-Meteo forecast"
        except Exception as error:  # network failure falls back to the manual/no-rain projection
            weather_note = f"live forecast unavailable ({type(error).__name__}); {weather_note}"
    result = farm_decision(
        farm,
        predicted_soil_moisture=float(farm["Predicted_Soil_Moisture"]),
        crop_age_days=payload.crop_age_days,
        sensor_soil_moisture=payload.sensor_soil_moisture,
        soil_type=payload.soil_type,
        irrigation_method=payload.irrigation_method,
        pump_flow_m3h=payload.pump_flow_m3h,
        forecast=forecast,
        language=payload.language,
    )
    result["weather"] = {"note": weather_note, "forecast": forecast or None}
    return result


@app.get("/fleet")
def fleet(
    crop_age_days: int = Query(180, ge=0, le=500),
    soil_type: str | None = None,
    irrigation_method: str | None = None,
    pump_flow_m3h: float | None = Query(None, gt=0),
) -> list[dict[str, Any]]:
    """Irrigation status for every farm under shared crop and equipment settings."""
    _artifact()
    agronomy = load_config()["agronomy"]
    return fleet_status(
        str(MODEL_PATH),
        crop_age_days,
        soil_type or agronomy["default_soil"],
        irrigation_method or agronomy["default_method"],
        float(pump_flow_m3h or agronomy["default_pump_flow_m3h"]),
        date.today().isoformat(),
    )


@app.get("/validation")
def validation() -> dict[str, Any]:
    """Spatial validation summary and results produced by `python -m src.validation`."""
    summary_path = REPORTS_DIR / "spatial_validation_summary.json"
    results_path = REPORTS_DIR / "spatial_validation.csv"
    if not summary_path.exists() or not results_path.exists():
        raise HTTPException(status_code=404, detail="Run `python -m src.validation` first.")
    results = pd.read_csv(results_path)
    return {
        "summary": json.loads(summary_path.read_text(encoding="utf-8")),
        "results": [{key: clean(value) for key, value in row.items()} for row in results.to_dict("records")],
        "figure": "/figures/spatial_validation.png",
    }


@app.get("/coverage")
def coverage() -> dict[str, Any]:
    return {
        "models": AI_MODELS,
        "workflow": [{"stage": stage, "provides": text} for stage, text in WORKFLOW_STAGES],
    }


@app.get("/", include_in_schema=False)
def root() -> RedirectResponse:
    return RedirectResponse(url="/app/")


if (REPORTS_DIR / "figures").exists():
    app.mount("/figures", StaticFiles(directory=REPORTS_DIR / "figures"), name="figures")
if FRONTEND_DIR.exists():
    app.mount("/app", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
