---
title: AquaAdvisory — Sugarcane Irrigation Intelligence
emoji: 💧
colorFrom: blue
colorTo: indigo
sdk: docker
pinned: false
app_port: 7860
---

# AquaAdvisory — KJS-AGR-01

**Sugarcane precision irrigation advisory system** for the KIAAR Sameerwadi region, Karnataka.

Built with FAO-56 crop water balance, ML soil moisture prediction, and a real-time React dashboard.

## Features
- Farm-level irrigation advisory (FAO-56 engine)
- Fleet map — 1,000 plots coloured by irrigation status
- Pump scheduling (feeder-level slot allocation)
- ML soil moisture model with spatial validation
- Human review / HITL feedback loop
- Multilingual advisory (English, Kannada, Hindi, Marathi)

## Access
- Dashboard: /app/
- API docs: /docs

## Run locally
```bash
pip install -r requirements.txt
python -m src.train            # only if models/soil_moisture_pipeline.joblib is missing
uvicorn api.main:app --reload  # API on :8000, built dashboard at http://127.0.0.1:8000/app/

# Frontend development with hot reload (proxies API calls to :8000)
cd frontend && npm install && npm run dev   # http://localhost:3000/app/
npm run build                              # refresh frontend/dist served by FastAPI
```
Set `API_TARGET` to proxy to another port (e.g. `API_TARGET=http://localhost:7860 npm run dev`),
or `VITE_API_BASE` at build time to host the UI separately from the API (`CORS_ORIGINS` on the API side).

## Soil-moisture calibration (prototype assumption)
The model's soil moisture is a coarse satellite value (0.217–0.256 m³/m³ across all farms).
Read as an absolute root-zone value it made every farm "not required" on sandy loam and
"irrigate now" on clay. The engine now ranks it within the fleet and maps that rank onto the
selected soil's available water (`soil_moisture_calibration` in `config.yaml`, `src/calibration.py`).
A probe reading is always used as measured. Set `method: absolute` to restore the old behaviour.

## Stack
React + Vite · FastAPI · scikit-learn · Leaflet · Recharts · Docker
