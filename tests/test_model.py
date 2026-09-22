from __future__ import annotations

from src.data_loader import RAW_FEATURE_COLUMNS
from src.predict import load_artifact, predict_record, what_if


def test_saved_model_predicts_and_explains(source_data, trained_model_path):
    artifact = load_artifact(trained_model_path)
    record = source_data.iloc[0]
    result = predict_record(artifact, record, farm_id=str(record["Farm_ID"]))
    assert 0 < result["advisory"]["predicted_soil_moisture"] < 1
    assert result["advisory"]["risk_level"] in {"LOW", "MODERATE", "HIGH"}
    assert result["explanation"]["contributions"]


def test_what_if_uses_saved_model(source_data, trained_model_path):
    artifact = load_artifact(trained_model_path)
    record = source_data.iloc[0][RAW_FEATURE_COLUMNS].to_dict()
    record["Farm_ID"] = source_data.iloc[0]["Farm_ID"]
    result = what_if(artifact, record, {"Rainfall_mm": 700.0, "Temperature_C": 20.0})
    assert result["simulation"] is True
    assert "original" in result and "simulated" in result
    assert isinstance(result["prediction_change"], float)

