"""Configurable prototype irrigation-risk decisions and farmer-friendly wording."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG_PATH = PROJECT_ROOT / "config.yaml"


def load_config(path: str | Path = DEFAULT_CONFIG_PATH) -> dict[str, Any]:
    with Path(path).open("r", encoding="utf-8") as file:
        return yaml.safe_load(file) or {}


def risk_level(predicted_soil_moisture: float, config: dict[str, Any]) -> str:
    thresholds = config["irrigation"]
    if predicted_soil_moisture < float(thresholds["high_risk_below"]):
        return "HIGH"
    if predicted_soil_moisture < float(thresholds["moderate_risk_below"]):
        return "MODERATE"
    return "LOW"


def _friendly_feature_name(name: str) -> str:
    return name.replace("_", " ").replace(".geo", "farm geometry")


def recommendation_for(risk: str) -> str:
    advice = {
        "HIGH": (
            "Prototype alert: predicted soil moisture is below the configured high-risk threshold. "
            "Inspect field conditions and consult local agricultural guidance before scheduling irrigation."
        ),
        "MODERATE": (
            "Prototype advisory: monitor soil conditions and rainfall, then assess irrigation need "
            "with local agronomic guidance."
        ),
        "LOW": (
            "Prototype advisory: no immediate moisture-risk alert from this model. Continue normal "
            "field monitoring and follow local agronomic guidance."
        ),
    }
    return advice[risk]


def build_advisory(
    farm_id: str,
    predicted_soil_moisture: float,
    explanation: dict[str, Any],
    model_confidence: float,
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    config = config or load_config()
    risk = risk_level(predicted_soil_moisture, config)
    factors = explanation.get("top_factors", [])
    return {
        "farm_id": str(farm_id),
        "predicted_soil_moisture": round(float(predicted_soil_moisture), 6),
        "risk_level": risk,
        "recommendation": recommendation_for(risk),
        "key_factors": [_friendly_feature_name(str(factor)) for factor in factors],
        "model_confidence": round(float(model_confidence), 4),
        "confidence_note": "Relative prototype model-agreement score; it is not a calibrated probability.",
        "threshold_note": "Risk thresholds are configurable prototype decision thresholds, not agronomically validated thresholds.",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

