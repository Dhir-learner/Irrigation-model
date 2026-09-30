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

## Stack
React + Vite · FastAPI · scikit-learn · Leaflet · Recharts · Docker
