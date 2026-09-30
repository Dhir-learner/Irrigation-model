# Contribution to KJS-AGR-01: Irrigation Advisory System for Sugarcane

**Use case:** KJS-AGR-01, AI Use Case Integration in Teaching-Learning
**Collaborators:** K J Somaiya Institute of Applied Agricultural Research (KIAAR) and Godavari Biorefineries Ltd.
**Dataset:** `IrrigationAdvisoryDataset.csv`, 1,000 sugarcane plots in 6 taluks of Mandya district, with satellite vegetation indices, weather, soil and plot polygons

## Summary

This contribution is a working prototype of the advisory platform described in the use-case document. It covers stages 1 to 10 of the workflow at prototype level, and 10 of the 11 requested AI models in full or in part.

It has three parts.

1. **An honest assessment of what the dataset supports.** The soil-moisture model scores R² = 0.9998 on a random split. On a village it has never seen, it does no better than predicting the average. The report explains why and what it means for the design.
2. **A plot-level decision engine that does not depend on missing labels.** The dataset has no irrigation dates, durations, stress or yield records, so these outputs are not trained predictions. They come from FAO-56 and FAO-33 crop-water equations, with every parameter stated and configurable.
3. **A usable platform around it.** It includes a dashboard with a GIS map, a REST API, pump scheduling against electricity windows, advisories in four languages, a live weather connector and a human review loop. All of it is covered by automated tests.

## Key finding: the model does not transfer to new villages

| Validation scheme | Best model MAE | Mean-baseline MAE | Best R² |
| --- | ---: | ---: | ---: |
| Random 5-fold | 0.00001 | 0.00644 | 1.000 |
| Leave-one-village-out | 0.00713 | 0.00714 | −0.50 |
| Leave-one-taluk-out | 0.00512 | 0.00691 | −0.09 |

Soil moisture in the dataset has only 33 distinct values. Six of the ten villages have exactly one value for every plot. The target behaves like a coarse satellite grid cell, so a random split lets the model look up a village's value rather than learn a relationship.

This matters for the 18,000 to 25,000 farms in scope. A model that only memorises surveyed villages cannot advise a new one. The platform therefore treats a field probe reading as the primary soil-moisture source and the model as a labelled fallback. This directly supports the use case's IoT sensor objective. Evidence is in `reports/spatial_validation.csv` and `reports/figures/spatial_validation.png`.

## Coverage of the requested AI models

| Requested model | Status | How it is done |
| --- | --- | --- |
| Next irrigation date | Rule-based | Daily FAO-56 root-zone water balance over 14 days. Irrigation is due when depletion reaches readily available water. |
| Irrigation duration | Rule-based | Refill depth, divided by method efficiency, times area, divided by pump discharge. |
| Crop water requirement | Rule-based | ETc = Kc × ETo, with FAO-56 sugarcane Kc by stage. ETo comes from Blaney-Criddle, or from Penman-Monteith in the live forecast. |
| Water stress probability | Partial | FAO-56 stress coefficient Ks as a 0 to 1 index. It is not a calibrated probability, because there are no stress labels. |
| Rainfall-adjusted recommendation | Rule-based | Forecast rain becomes effective rain. The plan reports how many days irrigation is postponed. |
| Yield loss from delayed irrigation | Rule-based | FAO-33 yield response factor Ky applied to the evapotranspiration deficit during the delay. |
| Pump scheduling optimisation | Rule-based | Sessions placed in supply windows, morning first. A feeder-level allocator caps how many pumps run at once. |
| Fertigation recommendation | Rule-based | Stage-split NPK, with nitrogen adjusted by organic-carbon rating. Doses are converted to urea, MAP and MOP per acre. |
| Disease and water stress forecasting | Partial | Water stress is projected 14 days ahead. Disease is not covered, because the dataset has no disease records. |
| Yield prediction | Blocked | Needs harvested yield per plot from GBL cane records. |
| Farmer-friendly advisory (LLM) | Implemented | Templates in English, Kannada, Hindi and Marathi. An optional Claude rewrite is discarded if any number changes. |

"Rule-based" means published agronomic equations with prototype parameters. It is a deliberate choice, since training on labels that do not exist would produce fabricated results. Each rule-based output is a candidate label target once KIAAR logs real irrigation events.

## Coverage of the workflow stages

| Stage | What the prototype provides |
| --- | --- |
| 1. Field data acquisition | A probe reading can be entered in the dashboard or API, and it overrides the model estimate. |
| 2. Transmission and integration | FastAPI service, SQLite logging and an Open-Meteo forecast connector. |
| 3. Pre-processing and features | Leakage-safe scikit-learn pipeline with polygon centroids and interaction terms. |
| 4. AI analytics | Model comparison, spatial validation audit and the FAO-56 engine. |
| 5. Decision support engine | Irrigation status, depth, duration, stress, rainfall adjustment, yield loss and fertigation. |
| 6. Generative AI advisory | Four-language advisories with an optional LLM rewrite and number verification. |
| 7. Dashboard | Web frontend served by the API, modelled on the use-case sample screen, plus a Streamlit dashboard. |
| 8. Smart irrigation automation | Pump session plans a controller could execute. No hardware is connected. |
| 9. Farmer interaction | Advisory text in the farmer's language and an accept, modify or reject form. |
| 10. Continuous learning | Review decisions are stored as future training labels. |

## Example results from the prototype

**Farm MM-MD-0110, Bheemanahalli, 0.74 ha, grand-growth stage, furrow irrigation, 18 m³/h pump**

| Output | Value |
| --- | --- |
| Crop water use | 6.4 mm/day |
| Next irrigation | 12 days out, without rain |
| Water to apply | 151 mm gross, 1,112 m³ |
| Pump time | 62 hours, spread over the 05:00, 14:00 and 20:00 supply windows |
| Live forecast effect | 57 mm of forecast rain postpones irrigation by 9 days |
| Yield loss if 10 days late | 1.0% in grand growth, 5.0% in tillering |

**Feeder capacity.** With furrow irrigation, one village's 102 due farms need about 6,300 pump-hours. A 25-pump feeder over 21 days leaves about 4,200 hours unmet. This shows at plot level why the use case lists electricity availability as a constraint, and what drip irrigation would change.

## Governance built into the prototype

- **Human in the loop.** Every advisory can be accepted, modified or rejected, and the reviewer and override are logged.
- **Transparency.** Every output states whether it came from the ML model, a sensor or an FAO equation. Each parameter is in `config.yaml` with its source.
- **Privacy.** No farmer names or phone numbers are stored. The weather call sends only rounded plot coordinates, and only when the user asks for it.
- **LLM safety.** The language model only rewords verified facts, and the output is rejected if a number is changed or dropped.

## What is needed from KIAAR and GBL to move beyond the prototype

1. In-field soil-moisture probes at 30 cm and 60 cm on a sample of plots in several villages.
2. Planting or ratoon dates, soil texture and irrigation method per plot, from STEPS.
3. Logged irrigation events and harvested yields, to validate and later replace the rule-based outputs.
4. KIAAR fertiliser recommendations and the ESCOM feeder timetable, to replace placeholder values.
5. Native-speaker review of the Kannada, Hindi and Marathi advisory wording.

## How to run the demonstration

```powershell
.\.venv\Scripts\Activate.ps1
python -m src.train          # soil-moisture model
python -m src.validation     # spatial validation report
pytest                       # 22 automated tests
uvicorn api.main:app --reload   # web frontend at http://127.0.0.1:8000/, API docs at /docs
streamlit run dashboard/app.py  # optional Streamlit dashboard
```

A suggested walkthrough follows the dashboard tabs from left to right. Start with **Farm advisory** and switch the language to Kannada. Enter a probe reading of 0.15 to see the plan change to "Irrigate now", then fetch the live forecast. Next, open **Pump scheduling** for a village, then **Model validation** for the key finding. End with **Use-case coverage**.
