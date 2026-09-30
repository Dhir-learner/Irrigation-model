---
title: AquaAdvisory – Sugarcane Irrigation Intelligence
emoji: 💧
colorFrom: blue
colorTo: cyan
sdk: docker
app_port: 7860
pinned: false
---

# 💧 AquaAdvisory — AI Irrigation Advisory for Sugarcane

**KJS-AGR-01 prototype** — plot-level irrigation decision support powered by FAO-56 agronomy equations and a Gradient Boosting soil-moisture ML model.

## Features

| Tab | What it provides |
|-----|-----------------|
| **Farm Advisory** | Status badge, 5 KPIs, 14-day water balance chart, fertigation table, pump sessions, advisory text, PDF export |
| **Fleet Map** | All farms colour-coded by irrigation urgency on an interactive Leaflet map |
| **Pump Scheduling** | Gantt chart of optimal pump sessions within electricity supply windows |
| **Model Validation** | Spatial leave-one-village-out validation metrics |
| **Use-case Coverage** | Which AI components are implemented vs rule-based vs blocked |
| **Review Log** | Human-in-the-loop feedback records |

## Tech stack
- **Frontend**: React 18 + Vite + Recharts + Leaflet
- **Backend**: FastAPI + scikit-learn Gradient Boosting
- **Deployment**: Docker on Hugging Face Spaces

## ⚠️ Disclaimer
Irrigation quantities are FAO-56 engine outputs using prototype parameters and are **not agronomically validated prescriptions**. Do not use operationally without field validation.
