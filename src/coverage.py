"""Traceability from the KJS-AGR-01 use-case document to this implementation."""

from __future__ import annotations

# Status vocabulary:
#   ML model     - trained on the supplied labelled data
#   Rule-based   - FAO / agronomic equations with stated parameters; no training labels exist
#   Implemented  - built as requested (templates plus an optional LLM)
#   Partial      - a defensible proxy; the exact requested output needs data we do not have
#   Blocked      - needs labelled data that the supplied dataset does not contain

AI_MODELS = [
    {
        "use_case_model": "Soil moisture estimation (supports all models)",
        "status": "ML model",
        "implementation": "Gradient Boosting pipeline on NDVI, LAI, weather, soil and location features (src/train.py).",
        "evidence": "reports/final_model_metrics.json; reports/spatial_validation.csv",
        "limitation": "Near-perfect on a random split, but no better than the mean on unseen villages.",
    },
    {
        "use_case_model": "Next irrigation date prediction",
        "status": "Rule-based",
        "implementation": "Daily FAO-56 root-zone depletion projection; irrigation is due when depletion reaches RAW.",
        "evidence": "src/agronomy.py irrigation_plan; tests/test_agronomy.py",
        "limitation": "No historical irrigation events to train or validate against.",
    },
    {
        "use_case_model": "Irrigation duration prediction",
        "status": "Rule-based",
        "implementation": "Net depth / application efficiency x area / pump discharge.",
        "evidence": "src/agronomy.py recommendation block",
        "limitation": "Pump discharge and efficiency are user inputs or defaults.",
    },
    {
        "use_case_model": "Crop water requirement prediction",
        "status": "Rule-based",
        "implementation": "ETc = Kc x ETo with FAO-56 sugarcane Kc by stage; ETo from Blaney-Criddle or Open-Meteo Penman-Monteith.",
        "evidence": "src/agronomy.py; src/weather.py",
        "limitation": "Blaney-Criddle is a temperature-only approximation.",
    },
    {
        "use_case_model": "Water stress probability model",
        "status": "Partial",
        "implementation": "FAO-56 water stress coefficient Ks and a 0-1 stress index with a 14-day projection.",
        "evidence": "src/agronomy.py water_stress_coefficient",
        "limitation": "An index, not a calibrated probability: no observed stress labels.",
    },
    {
        "use_case_model": "Rainfall-adjusted irrigation recommendation",
        "status": "Rule-based",
        "implementation": "Forecast rain converted to effective rain; reports how many days irrigation is postponed.",
        "evidence": "src/agronomy.py rainfall_adjustment; tests/test_agronomy.py",
        "limitation": "Effective-rain rule is a prototype assumption.",
    },
    {
        "use_case_model": "Yield loss prediction due to delayed irrigation",
        "status": "Rule-based",
        "implementation": "FAO-33 yield response: loss = Ky x (1 - ETa/ETm) for the stress accumulated during the delay.",
        "evidence": "src/agronomy.py yield_loss_for_delay",
        "limitation": "Relative loss only; not validated against KIAAR yield trials.",
    },
    {
        "use_case_model": "Pump scheduling optimization",
        "status": "Rule-based",
        "implementation": "Per-farm sessions in electricity supply windows plus feeder-level allocation with a concurrent-pump cap.",
        "evidence": "src/scheduling.py; tests/test_scheduling.py",
        "limitation": "Greedy earliest-due-first heuristic, not a proven optimum; feeder timetable is a placeholder.",
    },
    {
        "use_case_model": "Fertigation recommendation model",
        "status": "Rule-based",
        "implementation": "Stage-split NPK with organic-carbon nitrogen adjustment, converted to urea, MAP and MOP per acre.",
        "evidence": "src/agronomy.py fertigation_plan",
        "limitation": "Seasonal doses are placeholders to be replaced with the KIAAR / UAS recommendation.",
    },
    {
        "use_case_model": "Disease and water stress forecasting",
        "status": "Partial",
        "implementation": "Water stress is forecast through the 14-day water balance.",
        "evidence": "src/agronomy.py projection",
        "limitation": "Disease forecasting is blocked: the dataset has no disease observations.",
    },
    {
        "use_case_model": "Yield prediction model",
        "status": "Blocked",
        "implementation": "Not implemented.",
        "evidence": "reports/dataset_profile.json has no yield column",
        "limitation": "Needs harvested yield per plot from GBL cane records.",
    },
    {
        "use_case_model": "Farmer-friendly advisory generation (LLM)",
        "status": "Implemented",
        "implementation": "Templates in English, Kannada, Hindi and Marathi; optional Claude rewrite with a check that no number changed.",
        "evidence": "src/multilingual.py; tests/test_multilingual.py",
        "limitation": "Translations need native-speaker review; LLM path needs Anthropic credentials.",
    },
]

WORKFLOW_STAGES = [
    ("1. Field data acquisition", "Sensor soil-moisture input overrides the model (dashboard and /irrigation-plan)."),
    ("2. Data transmission and integration", "FastAPI endpoints, SQLite logs, Open-Meteo forecast connector."),
    ("3. Pre-processing and feature engineering", "Leakage-safe scikit-learn pipeline with geometry centroids and interactions."),
    ("4. AI analytics and predictive modelling", "Model comparison, spatial validation audit, FAO-56 engine."),
    ("5. Decision support engine", "Irrigation status, depth, duration, rainfall adjustment, yield loss, fertigation."),
    ("6. Generative AI advisory layer", "Four-language templates with optional Claude rewrite and number verification."),
    ("7. Dashboard and mobile app", "Streamlit dashboard with GIS map, farm advisory, scheduling and validation tabs."),
    ("8. Smart irrigation automation", "Pump session plans ready for a controller; no hardware is connected."),
    ("9. Farmer interaction and support", "Advisory text per language; accept, modify or reject feedback form."),
    ("10. Continuous learning and feedback", "Feedback table stores human decisions as future training labels."),
]
