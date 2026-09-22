from __future__ import annotations

from src.advisory import build_advisory, load_config, risk_level


def test_prototype_risk_thresholds_and_advisory():
    config = load_config()
    assert risk_level(0.21, config) == "HIGH"
    assert risk_level(0.225, config) == "MODERATE"
    assert risk_level(0.24, config) == "LOW"
    advisory = build_advisory(
        farm_id="MM-MD-0110",
        predicted_soil_moisture=0.21,
        explanation={"top_factors": ["Rainfall_mm", "NDVI"]},
        model_confidence=0.8,
        config=config,
    )
    assert advisory["risk_level"] == "HIGH"
    assert "prototype" in advisory["threshold_note"].lower()
    assert advisory["key_factors"] == ["Rainfall mm", "NDVI"]

