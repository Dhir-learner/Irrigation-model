"""FastAPI endpoints served from the persisted model artifact."""

from __future__ import annotations

from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from src.database import DEFAULT_DB_PATH, initialize_database, log_prediction
from src.predict import load_artifact, predict_record, what_if
from src.train import DEFAULT_MODEL_PATH


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODEL_PATH = DEFAULT_MODEL_PATH
DB_PATH = DEFAULT_DB_PATH


@asynccontextmanager
async def lifespan(_app: FastAPI):
    initialize_database(DB_PATH)
    yield


app = FastAPI(
    title="AI Irrigation Advisory API",
    version="0.1.0",
    lifespan=lifespan,
    description=(
        "Prototype soil-moisture prediction and irrigation-risk advisory. "
        "It does not provide validated irrigation quantities or forecasts."
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
