# AI Irrigation Advisory System for Sugarcane
## End-to-End Implementation Specification for an AI Coding Agent

## 1. Project Objective

Build a complete, runnable prototype of the **KJS-AGR-01: Irrigation Advisory System for Sugarcane Crop using AI and Sensor-based Technology**.

The implementation must go beyond a theoretical proposal. It must include:

**Dataset → EDA → preprocessing → feature engineering → ML training → model comparison → model selection → saved model → prediction API → irrigation decision engine → explainable advisory → interactive dashboard → geospatial farm visualization → what-if simulation → documentation.**

The source use case proposes plot-specific irrigation recommendations by integrating field observations, weather information, crop requirements, sensors, geospatial information and AI/ML. It lists potential AI models including next irrigation date, irrigation duration, crop water requirement, water-stress probability, rainfall-adjusted irrigation, yield-loss prediction, pump scheduling, fertigation, disease/water-stress forecasting and yield prediction.

For this prototype, **do not claim to predict variables for which the supplied CSV has no ground-truth target**. The first implementation should focus on:

1. Soil-moisture prediction.
2. Irrigation-risk/advisory generation.
3. Explainable AI.
4. Geospatial farm visualization.
5. What-if simulation.

Actual irrigation date, irrigation quantity/duration and yield prediction should be treated as future extensions unless appropriate labeled historical targets are available.

---

# 2. Source Material

Primary use-case document:

**KJS-AGR-01 – Irrigation Advisory System for Sugarcane Crop using AI and Sensor-based Technology**

The use case identifies the agriculture domain and describes a system integrating IoT sensors, geospatial data, weather data, farm information and ML models.

The provided dataset is:

`IrrigationAdvisoryDataset.csv`

The implementation must inspect the actual CSV before deciding exact preprocessing and target handling.

---

# 3. Important Dataset Rule

Before writing the ML pipeline:

1. Load the CSV.
2. Print:
   - shape
   - column names
   - dtypes
   - missing values
   - unique counts
   - numerical summary
   - categorical values
3. Identify the actual target candidates.
4. Do NOT invent labels.
5. Do NOT use a variable as a prediction target merely because its name sounds suitable.
6. Clearly document which target is actually available.

The currently expected dataset contains fields related to:

- Farm ID
- District
- Taluk
- Village
- NDVI
- LAI
- Soil Moisture
- Soil pH
- Organic Carbon
- Rainfall
- Relative Humidity
- Temperature
- Farm Area
- Geospatial polygon information

The actual CSV must be treated as the source of truth.

---

# 4. Core ML Problem

## Primary model

Build a **regression model to predict Soil Moisture** if the dataset supports this target and there are valid explanatory features.

Example conceptual inputs:

- NDVI
- LAI
- Soil pH
- Organic Carbon
- Rainfall
- Relative Humidity
- Temperature
- Farm Area
- Location-derived features where appropriate

Target:

`Soil Moisture`

Do not use the target itself, duplicate columns, or post-outcome information as input features.

---

# 5. ML Pipeline

Implement the following pipeline.

## Step 1 — Data ingestion

Create:

`src/data_loader.py`

Responsibilities:

- Load CSV.
- Validate required/available columns.
- Report missing values.
- Handle malformed records.
- Return a clean DataFrame.

---

## Step 2 — Exploratory Data Analysis

Create:

`notebooks/01_EDA.ipynb`

Include:

### Dataset overview

- Number of records.
- Number of features.
- Numerical/categorical columns.
- Missing values.
- Duplicate records.

### Statistical analysis

- Mean.
- Median.
- Standard deviation.
- Min/max.
- Quartiles.

### Visualizations

Create useful plots such as:

- Soil moisture distribution.
- Temperature distribution.
- Rainfall distribution.
- NDVI vs soil moisture.
- LAI vs soil moisture.
- Rainfall vs soil moisture.
- Temperature vs soil moisture.
- Correlation heatmap.
- District-wise soil moisture.
- Scatter plots with regression trends where useful.

Save important figures under:

`reports/figures/`

---

# 6. Data Preprocessing

Create:

`src/preprocessing.py`

Requirements:

- Remove exact duplicates if justified.
- Handle missing values.
- Detect obvious invalid numerical values.
- Encode categorical features.
- Scale features where required.
- Keep preprocessing reproducible.
- Avoid data leakage.

Use a Scikit-learn `Pipeline` and/or `ColumnTransformer`.

The preprocessing object must be saved together with the model or embedded in the model pipeline.

---

# 7. Feature Engineering

Create:

`src/features.py`

Potential derived features:

- Rainfall-temperature interaction.
- Humidity-temperature interaction.
- Vegetation index categories.
- Rainfall availability indicators.
- Temperature bands.
- Location encoding.

Only create features that are justified by the available data.

Do not create artificial values or fake sensor readings.

If the dataset contains temporal information, consider:

- Rainfall rolling statistics.
- Previous observation features.
- Lag features.

Only use lag features when the dataset has a valid temporal structure.

---

# 8. Model Training

Create:

`src/train.py`

Train multiple candidate models.

At minimum:

1. Linear Regression — baseline.
2. Random Forest Regressor.
3. Extra Trees Regressor.
4. Gradient Boosting Regressor.
5. XGBoost Regressor if dependency availability permits.

If XGBoost is unavailable, the project must still work using Scikit-learn models.

---

# 9. Train/Test Methodology

Use an appropriate train/validation/test strategy.

If observations are independent:

- Train: 70%
- Validation: 15%
- Test: 15%

If temporal ordering exists, use a time-aware split instead of random splitting.

If farms repeat across multiple records, consider a group-aware split by Farm ID to avoid leakage between the same farms.

The agent must inspect the dataset and select the appropriate strategy.

Document the reasoning in the README.

---

# 10. Evaluation Metrics

For regression report:

- MAE
- RMSE
- R²

Example output:

```text
Model                MAE      RMSE      R²
------------------------------------------------
Linear Regression    ...
Random Forest        ...
Extra Trees          ...
Gradient Boosting    ...
XGBoost              ...
```

Do not hard-code or invent performance numbers.

Select the model based on validation performance, while considering generalization and model complexity.

Evaluate the final model once on the held-out test set.

Save:

`reports/model_comparison.csv`

and:

`reports/final_model_metrics.json`

---

# 11. Model Explainability

Use SHAP where compatible.

Create:

`src/explainability.py`

Provide:

- Global feature importance.
- Local feature contribution for an individual farm.
- Top factors affecting a prediction.

Example dashboard explanation:

```text
Prediction
Predicted soil moisture: XX%

Main contributing factors:
1. Rainfall
2. Temperature
3. NDVI
4. Relative Humidity
```

The exact ordering must come from the trained model/explanation, not hard-coded text.

If SHAP cannot run for a particular model, provide a model-compatible fallback such as permutation importance.

---

# 12. Irrigation Decision Engine

Create:

`src/advisory.py`

The ML model predicts soil moisture.

The decision engine converts model output and available environmental information into an advisory.

Example conceptual states:

```text
LOW RISK
MODERATE RISK
HIGH RISK
```

The implementation must make thresholds configurable in:

`config.yaml`

Example:

```yaml
irrigation:
  low_threshold: ...
  moderate_threshold: ...
  high_threshold: ...

confidence:
  minimum: ...
```

Do not present arbitrary thresholds as agronomically validated.

Clearly label prototype thresholds as **configurable prototype decision thresholds** until validated by agricultural experts.

---

# 13. Advisory Generation

For every farm, generate a structured advisory containing:

```json
{
  "farm_id": "...",
  "predicted_soil_moisture": 0.0,
  "risk_level": "...",
  "recommendation": "...",
  "key_factors": [],
  "model_confidence": 0.0,
  "timestamp": "..."
}
```

The advisory should be understandable to a farmer.

Example style:

```text
Farm: ABC123

Current assessment:
Moderate irrigation requirement.

Predicted soil moisture:
XX%

Main factors:
• Low recent rainfall
• Elevated temperature
• Current vegetation condition

Recommended action:
Monitor the field and assess irrigation requirement according to
local agronomic guidance.
```

Do not claim a medically, agronomically or scientifically validated recommendation unless validation exists.

---

# 14. Geospatial Visualization

If valid farm polygon/geospatial data exists, create an interactive farm map.

Use:

- GeoPandas
- Folium or Plotly Mapbox/compatible mapping approach

Display:

- Farm polygons.
- Farm ID.
- District/Taluk/Village.
- Soil moisture.
- Risk level.
- Advisory.

Conceptual map:

```text
Farm Map

🟢 Low
🟡 Moderate
🔴 High
```

Do not fabricate coordinates.

If geometry is malformed, gracefully display the farm data in a table instead of inventing geometry.

---

# 15. Dashboard

Build the dashboard using **Streamlit**.

File:

`dashboard/app.py`

Dashboard sections:

## A. Overview

Display:

- Total farms.
- Farms analyzed.
- Average predicted soil moisture.
- Number of low/moderate/high risk farms.
- Model name.
- Model test metrics.

## B. Farm Search

Allow user to search/select:

- Farm ID
- District
- Taluk
- Village

## C. Farm Details

Show:

- Farm ID
- Location
- Farm area
- NDVI
- LAI
- Rainfall
- Temperature
- Humidity
- Soil pH
- Organic carbon
- Predicted soil moisture
- Risk level
- Advisory

## D. Explainable AI

Show feature contributions for selected farm.

## E. Interactive Map

Show all farms where valid geometry exists.

## F. What-if Simulator

Allow user to change selected environmental variables such as:

- Rainfall
- Temperature
- Relative humidity

Then rerun the ML pipeline and show:

```text
Original prediction
        ↓
What-if prediction
        ↓
Change
        ↓
Updated irrigation risk
```

---

# 16. What-if Simulation

This is a major value addition.

Example:

```text
Current:
Rainfall = 10 mm
Temperature = 34°C

Predicted soil moisture = X
Risk = HIGH

What-if:
Rainfall = 30 mm
Temperature = 32°C

Predicted soil moisture = Y
Risk = MODERATE
```

The values must be generated by the actual trained model.

Clearly mark the result as a **simulation**, not a real weather forecast.

---

# 17. Backend API

Create:

`api/main.py`

Use FastAPI.

Endpoints:

### GET

`/health`

Returns:

```json
{
  "status": "ok"
}
```

### POST

`/predict`

Accept farm/environmental features.

Return:

- prediction
- risk level
- advisory
- explanation

### POST

`/what-if`

Accept modified environmental conditions and return simulated results.

### GET

`/model-info`

Return:

- model name
- training date
- feature list
- test metrics

---

# 18. Model Serving

Save the complete preprocessing + model pipeline.

Example:

`models/soil_moisture_pipeline.joblib`

The API must load this saved artifact instead of retraining the model.

The dashboard must also use the saved model.

---

# 19. Database

For the first prototype use SQLite.

Create:

`database/app.db`

Store:

- Farm ID
- Timestamp
- Input features
- Prediction
- Risk level
- Advisory
- Model version

Create:

`src/database.py`

Do not store unnecessary personal information.

---

# 20. Project Architecture

Use this architecture:

```text
                     CSV / Future Sensors
                             │
                             ▼
                    ┌─────────────────┐
                    │ Data Ingestion  │
                    └────────┬────────┘
                             ▼
                    ┌─────────────────┐
                    │ Preprocessing   │
                    └────────┬────────┘
                             ▼
                    ┌─────────────────┐
                    │ Feature         │
                    │ Engineering     │
                    └────────┬────────┘
                             ▼
                    ┌─────────────────┐
                    │ ML Models       │
                    │ LR / RF / ET /  │
                    │ GB / XGBoost    │
                    └────────┬────────┘
                             ▼
                    ┌─────────────────┐
                    │ Model Selection │
                    └────────┬────────┘
                             ▼
                 ┌────────────────────────┐
                 │ Saved ML Pipeline      │
                 └───────────┬────────────┘
                             │
             ┌───────────────┼────────────────┐
             ▼               ▼                ▼
        FastAPI API      Streamlit       Batch Prediction
             │           Dashboard             │
             └───────────────┬─────────────────┘
                             ▼
                    ┌─────────────────┐
                    │ Advisory Engine │
                    └────────┬────────┘
                             ▼
              ┌──────────────────────────┐
              │ Explainable AI + Map     │
              │ + What-if Simulation     │
              └──────────────────────────┘
```

---

# 21. Recommended Folder Structure

Create:

```text
AI-Irrigation-Advisory/
│
├── data/
│   └── IrrigationAdvisoryDataset.csv
│
├── notebooks/
│   ├── 01_EDA.ipynb
│   ├── 02_Feature_Engineering.ipynb
│   └── 03_Model_Training.ipynb
│
├── src/
│   ├── __init__.py
│   ├── data_loader.py
│   ├── preprocessing.py
│   ├── features.py
│   ├── train.py
│   ├── predict.py
│   ├── advisory.py
│   ├── explainability.py
│   └── database.py
│
├── api/
│   ├── __init__.py
│   └── main.py
│
├── dashboard/
│   └── app.py
│
├── models/
│   └── soil_moisture_pipeline.joblib
│
├── reports/
│   ├── figures/
│   ├── model_comparison.csv
│   └── final_model_metrics.json
│
├── tests/
│   ├── test_preprocessing.py
│   ├── test_model.py
│   ├── test_advisory.py
│   └── test_api.py
│
├── config.yaml
├── requirements.txt
├── Dockerfile
├── .gitignore
└── README.md
```

---

# 22. Required Tests

The implementation must include automated tests.

Test:

1. Dataset loading.
2. Missing-value handling.
3. Feature preprocessing.
4. Model prediction.
5. Advisory generation.
6. What-if prediction.
7. API `/health`.
8. API `/predict`.
9. API `/what-if`.

Run:

```bash
pytest
```

All tests should pass before considering the implementation complete.

---

# 23. Requirements

Create `requirements.txt` with only dependencies actually used.

Expected libraries may include:

```text
pandas
numpy
scikit-learn
xgboost
joblib
matplotlib
seaborn
plotly
streamlit
fastapi
uvicorn
pydantic
geopandas
folium
streamlit-folium
shap
pyyaml
pytest
```

If a dependency is unnecessary, remove it.

The application should remain functional if optional XGBoost/SHAP functionality is unavailable.

---

# 24. Docker

Create a basic Dockerfile.

The container should support running the API and/or dashboard.

Example commands should be documented in README.

---

# 25. README Requirements

The README must explain:

1. Project overview.
2. Problem statement.
3. Use-case background.
4. Dataset.
5. Architecture.
6. Features.
7. ML methodology.
8. Target variable.
9. Feature list.
10. Model comparison.
11. Evaluation metrics.
12. Explainability.
13. Advisory logic.
14. Dashboard.
15. API.
16. Installation.
17. Training.
18. Running dashboard.
19. Running API.
20. Running tests.
21. Limitations.
22. Future work.

---

# 26. Important Scientific/Engineering Constraints

Do NOT:

- invent data;
- invent model metrics;
- claim agronomic validation;
- claim real-time sensor integration when sensors are not connected;
- claim actual weather forecasting;
- claim accurate irrigation quantities without appropriate labels;
- claim production readiness;
- hide poor model performance;
- use test data during training;
- leak the target into input features.

The system must clearly distinguish:

**Prediction**
from
**Decision rule**
from
**Simulation**
from
**Validated agricultural recommendation**.

---

# 27. Future Extensions

After the core implementation works, the architecture should allow:

### IoT integration

```text
Soil Moisture Sensor
        ↓
ESP32 / IoT Gateway
        ↓
API
        ↓
Database
        ↓
ML Model
        ↓
Advisory
```

### Weather API integration

Future weather observations/forecasts can be integrated after selecting an appropriate data provider.

### Additional ML models

When labeled historical data becomes available:

- Next irrigation date prediction.
- Irrigation duration prediction.
- Crop water requirement.
- Water stress probability.
- Yield loss prediction.
- Yield prediction.
- Pump scheduling optimization.
- Fertigation recommendation.

### LLM advisory layer

An LLM can later convert structured model outputs into multilingual farmer-friendly language.

The LLM must NOT alter the numerical ML prediction or invent agronomic facts.

---

# 28. Definition of Done

The project is complete only when all of the following work:

### Data

- [ ] CSV loads successfully.
- [ ] Dataset profile generated.
- [ ] Missing values handled.
- [ ] EDA completed.

### ML

- [ ] At least 3 ML models trained.
- [ ] Models evaluated.
- [ ] Best model selected using validation data.
- [ ] Final test evaluation generated.
- [ ] Model saved.
- [ ] No data leakage.

### Explainability

- [ ] Global feature importance.
- [ ] Individual prediction explanation.

### Advisory

- [ ] Risk classification.
- [ ] Farmer-friendly advisory.
- [ ] Configurable thresholds.
- [ ] Prototype limitations clearly stated.

### Dashboard

- [ ] Farm selector.
- [ ] Prediction.
- [ ] Risk level.
- [ ] Advisory.
- [ ] Model explanation.
- [ ] Farm map.
- [ ] What-if simulation.

### API

- [ ] `/health`
- [ ] `/predict`
- [ ] `/what-if`
- [ ] `/model-info`

### Engineering

- [ ] SQLite logging.
- [ ] Automated tests.
- [ ] README.
- [ ] requirements.txt.
- [ ] Dockerfile.
- [ ] Clean folder structure.

---

# 29. AI Coding Agent Instructions

You are an autonomous senior ML engineer and full-stack developer.

Build this project **end-to-end**, not as a mockup.

## Execution order

Follow this order:

1. Inspect the supplied CSV.
2. Determine the actual schema and target possibilities.
3. Create the project structure.
4. Implement data loading.
5. Perform EDA.
6. Implement preprocessing.
7. Implement feature engineering.
8. Train multiple models.
9. Evaluate them correctly.
10. Select and save the best model.
11. Implement explainability.
12. Implement the irrigation advisory engine.
13. Implement FastAPI.
14. Implement SQLite logging.
15. Implement Streamlit dashboard.
16. Implement geospatial visualization if valid geometry exists.
17. Implement what-if simulation.
18. Add tests.
19. Run tests.
20. Fix all errors.
21. Create/update README.
22. Verify the complete system from CSV to dashboard/API.

## Critical behavior

Do not stop after creating code files.

Actually execute:

```bash
python ...
pytest
```

and verify that the implementation works.

If errors occur, debug and fix them.

Do not fabricate results when the data does not support them.

At the end, provide:

```text
1. Dataset summary
2. Selected target
3. Features used
4. Models trained
5. Validation results
6. Final test results
7. Selected model
8. Dashboard URL/command
9. API URL/command
10. Test status
11. Known limitations
12. Future improvements
```

The final implementation should be suitable for demonstration as an **AI/ML value addition to the KJS-AGR-01 irrigation advisory use case**.
