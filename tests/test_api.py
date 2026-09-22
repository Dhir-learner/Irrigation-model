from __future__ import annotations

from fastapi.testclient import TestClient

from api import main


def _payload(record):
    return {
        "farm_id": str(record["Farm_ID"]),
        "LAI": float(record["LAI"]),
        "NDVI": float(record["NDVI"] if record["NDVI"] == record["NDVI"] else 0.5),
        "Organic_Carbon": float(record["Organic_Carbon"]),
        "Rainfall_mm": float(record["Rainfall_mm"]),
        "Relative_Humidity": float(record["Relative_Humidity"]),
        "Soil_pH": float(record["Soil_pH"]),
        "Temperature_C": float(record["Temperature_C"]),
        "Taluk": str(record["Taluk"]),
        "Village": str(record["Village"]),
        "geometry": str(record[".geo"]),
    }


def test_api_endpoints(source_data, trained_model_path, tmp_path, monkeypatch):
    monkeypatch.setattr(main, "MODEL_PATH", trained_model_path)
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "app.db")
    main._artifact.cache_clear()
    payload = _payload(source_data.iloc[0])
    with TestClient(main.app) as client:
        health = client.get("/health")
        assert health.status_code == 200
        assert health.json()["status"] == "ok"

        prediction = client.post("/predict", json=payload)
        assert prediction.status_code == 200
        assert prediction.json()["risk_level"] in {"LOW", "MODERATE", "HIGH"}
        assert prediction.json()["explanation"]["contributions"]

        simulation = client.post(
            "/what-if",
            json={
                "farm_id": payload["farm_id"],
                "features": {key: value for key, value in payload.items() if key != "farm_id"},
                "changes": {"Rainfall_mm": 700.0, "Temperature_C": 20.0},
            },
        )
        assert simulation.status_code == 200
        assert simulation.json()["simulation"] is True

        model_info = client.get("/model-info")
        assert model_info.status_code == 200
        assert "test_metrics" in model_info.json()
