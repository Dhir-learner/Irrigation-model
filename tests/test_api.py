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


def test_irrigation_scheduling_advisory_and_feedback_endpoints(source_data, trained_model_path, tmp_path, monkeypatch):
    monkeypatch.setattr(main, "MODEL_PATH", trained_model_path)
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "app.db")
    main._artifact.cache_clear()
    payload = _payload(source_data.iloc[0])
    with TestClient(main.app) as client:
        plan = client.post(
            "/irrigation-plan",
            json={
                **payload,
                "crop_age_days": 180,
                "Farm_Area_ha": 0.74,
                "forecast_rain_mm": [0, 0, 30],
                "language": "kn",
                "start_date": "2026-09-30",
            },
        )
        assert plan.status_code == 200, plan.text
        body = plan.json()
        assert body["soil_moisture_source"] == "ml_model"
        assert body["plan"]["recommendation"]["status"] in {"IRRIGATE_NOW", "IRRIGATE_SOON", "NOT_REQUIRED"}
        assert body["advisory_text"]

        sensor = client.post("/irrigation-plan", json={**payload, "crop_age_days": 180, "sensor_soil_moisture": 0.15})
        assert sensor.json()["soil_moisture_source"] == "sensor"
        assert sensor.json()["plan"]["recommendation"]["status"] == "IRRIGATE_NOW"

        advisory = client.post("/advisory", json={"facts": body["facts"], "language": "hi"})
        assert advisory.status_code == 200
        assert advisory.json()["source"] == "template"

        feeder = client.post(
            "/feeder-schedule",
            json={
                "farms": [{"farm_id": "A", "hours": 3, "due_day": 0}, {"farm_id": "B", "hours": 2, "due_day": 1}],
                "start_date": "2026-10-01",
                "max_concurrent": 1,
            },
        )
        assert feeder.status_code == 200
        assert feeder.json()["assignments"]

        recorded = client.post(
            "/feedback", json={"farm_id": payload["farm_id"], "decision": "modified", "override_hours": 4.0}
        )
        assert recorded.status_code == 200
        assert client.get("/feedback").json()[0]["decision"] == "modified"
        assert client.post("/feedback", json={"farm_id": "x", "decision": "maybe"}).status_code == 422


def test_frontend_endpoints_and_static_app(trained_model_path, tmp_path, monkeypatch):
    monkeypatch.setattr(main, "MODEL_PATH", trained_model_path)
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "app.db")
    main._artifact.cache_clear()
    with TestClient(main.app) as client:
        options = client.get("/options").json()
        assert "sandy_loam" in options["soils"] and set(options["languages"]) == {"en", "kn", "hi", "mr"}

        farms = client.get("/farms").json()
        assert len(farms) == 1000
        farm_id = farms[0]["farm_id"]

        geo = client.get("/farms/geojson", params={"village": farms[0]["village"]}).json()
        assert geo["type"] == "FeatureCollection" and geo["features"]

        detail = client.get(f"/farms/{farm_id}").json()
        assert detail["farm"]["Farm_ID"] == farm_id
        assert 0 < detail["model"]["predicted_soil_moisture"] < 1
        assert client.get("/farms/NOT-A-FARM").status_code == 404

        plan = client.post(f"/farms/{farm_id}/plan", json={"crop_age_days": 180, "language": "mr", "forecast_rain_mm": [0, 25, 20]})
        assert plan.status_code == 200, plan.text
        body = plan.json()
        assert body["weather"]["note"] == "manual rain input"
        assert body["plan"]["rainfall_adjustment"]["forecast_rain_mm"] == 45.0
        assert body["language"] == "mr"

        fleet = client.get("/fleet", params={"crop_age_days": 180}).json()
        assert len(fleet) == 1000
        assert {row["status"] for row in fleet} <= {"IRRIGATE_NOW", "IRRIGATE_SOON", "NOT_REQUIRED"}

        assert len(client.get("/coverage").json()["models"]) == 12
        assert client.get("/validation").status_code in {200, 404}

        page = client.get("/app/")
        assert page.status_code == 200 and '<div id="root">' in page.text
        assert client.get("/", follow_redirects=False).headers["location"] == "/app/"


def test_empty_farm_id_and_unknown_routes_explain_themselves(trained_model_path, tmp_path, monkeypatch):
    """Regression: the dashboard posted to /farms//plan after a Taluk change and showed {"detail":"Not Found"}."""
    monkeypatch.setattr(main, "MODEL_PATH", trained_model_path)
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "app.db")
    main._artifact.cache_clear()
    with TestClient(main.app) as client:
        missing = client.post("/farms//plan", json={"crop_age_days": 180})
        assert missing.status_code == 404
        assert "POST /farms//plan" in missing.json()["detail"]
        blank = client.post("/farms/%20/plan", json={"crop_age_days": 180})
        assert blank.status_code == 422 and "empty" in blank.json()["detail"]


def test_calibrated_fleet_spreads_statuses_and_what_if_uses_farm_record(trained_model_path, tmp_path, monkeypatch):
    monkeypatch.setattr(main, "MODEL_PATH", trained_model_path)
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "app.db")
    main._artifact.cache_clear()
    with TestClient(main.app) as client:
        for soil in ("sandy_loam", "clay"):
            fleet = client.get("/fleet", params={"crop_age_days": 180, "soil_type": soil}).json()
            statuses = {row["status"] for row in fleet}
            # The raw satellite value used to send every farm to one status per soil type.
            assert len(statuses) >= 2, (soil, statuses)

        farm_id = client.get("/farms").json()[0]["farm_id"]
        plan = client.post(f"/farms/{farm_id}/plan", json={"crop_age_days": 180}).json()
        calibration = plan["soil_moisture_calibration"]
        assert calibration["method"] == "percentile_rank" and 0 <= calibration["relative_wetness"] <= 1

        sensor = client.post(f"/farms/{farm_id}/plan", json={"crop_age_days": 180, "sensor_soil_moisture": 0.2}).json()
        assert sensor["soil_moisture_used"] == 0.2 and sensor["soil_moisture_calibration"] is None

        result = client.post(f"/farms/{farm_id}/what-if", json={"crop_age_days": 180, "changes": {"Rainfall_mm": 700}})
        assert result.status_code == 200, result.text
        body = result.json()
        detail = client.get(f"/farms/{farm_id}").json()
        assert body["original"]["model"]["predicted_soil_moisture"] == detail["model"]["predicted_soil_moisture"]
        assert {"status", "days_until_irrigation", "volume_m3"} <= set(body["simulated"]["plan"])
        bad = client.post(f"/farms/{farm_id}/what-if", json={"crop_age_days": 180, "changes": {"Nope": 1}})
        assert bad.status_code == 422

        analytics = client.get("/fleet/analytics", params={"crop_age_days": 180}).json()
        assert analytics["totals"]["farms"] == 1000
        assert sum(v["farms"] for v in analytics["villages"]) == 1000
        assert len(analytics["demand_calendar"]) == 14

        options = client.get("/options").json()
        assert options["feature_ranges"]["Rainfall_mm"]["max"] > options["feature_ranges"]["Rainfall_mm"]["min"]
        assert client.get("/model-info").json()["feature_list"]
