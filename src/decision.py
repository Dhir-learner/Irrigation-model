"""Plot-level decision support: ties the ML model, sensors, weather and FAO-56 engine together.

Soil-moisture source priority:
    1. An in-field sensor reading, when supplied (the IoT path). Used as measured.
    2. The saved ML model's prediction from the farm's remote-sensing features,
       converted to a root-zone value by ``src.calibration`` when a fleet
       reference distribution is supplied.

The spatial validation report shows the model does not generalise to unseen
villages, so every result records which source was used.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Sequence

import pandas as pd

from src.advisory import load_config
from src.agronomy import FarmConditions, agronomy_config, fertigation_plan, irrigation_plan, soil_properties, yield_loss_table
from src.calibration import rootzone_moisture
from src.features import geometry_center
from src.multilingual import advisory_facts, template_advisory
from src.scheduling import schedule_pump


def farm_decision(
    farm: pd.Series | dict[str, Any],
    predicted_soil_moisture: float | None,
    crop_age_days: int,
    sensor_soil_moisture: float | None = None,
    soil_type: str | None = None,
    irrigation_method: str | None = None,
    pump_flow_m3h: float | None = None,
    forecast: dict[str, list[Any]] | None = None,
    temperature_override: float | None = None,
    start_date: date | None = None,
    language: str = "en",
    config: dict[str, Any] | None = None,
    soil_moisture_reference: Sequence[float] | None = None,
) -> dict[str, Any]:
    """Produce the full advisory bundle for one farm.

    ``soil_moisture_reference`` is the fleet's model soil-moisture distribution;
    when given, a model estimate is converted to a root-zone value (see
    ``src.calibration``). Sensor readings are always used as measured.
    """
    config = config or load_config()
    record = farm if isinstance(farm, dict) else farm.to_dict()
    calibration: dict[str, Any] | None = None
    if sensor_soil_moisture is not None:
        soil_moisture, source = float(sensor_soil_moisture), "sensor"
    elif predicted_soil_moisture is not None:
        _, fc, wp = soil_properties(agronomy_config(config), soil_type)
        soil_moisture, calibration = rootzone_moisture(
            float(predicted_soil_moisture), soil_moisture_reference, fc, wp, config
        )
        source = "ml_model"
    else:
        raise ValueError("Provide a sensor reading or a model prediction for soil moisture.")

    longitude, latitude = geometry_center(record.get(".geo"))
    if latitude != latitude:  # NaN: fall back to the Mandya district latitude
        latitude = 12.52
    forecast = forecast or {}
    temperature = float(temperature_override if temperature_override is not None else record.get("Temperature_C", 25.0))

    conditions = FarmConditions(
        soil_moisture=soil_moisture,
        temperature_c=temperature,
        latitude=float(latitude),
        area_ha=float(record.get("Farm_Area_ha") or 1.0),
        crop_age_days=int(crop_age_days),
        soil_type=soil_type,
        irrigation_method=irrigation_method,
        pump_flow_m3h=pump_flow_m3h,
        # Keep None gaps in place: dropping them would shift later days onto the wrong date.
        # irrigation_plan's _series() substitutes the fallback for a missing day.
        forecast_rain_mm=[r if r is not None else 0.0 for r in forecast.get("rain_mm", [])],
        forecast_temp_c=list(forecast.get("temperature_c", [])),
        forecast_eto_mm=list(forecast.get("eto_mm", [])),
        organic_carbon=record.get("Organic_Carbon"),
        start_date=start_date,
    )
    plan = irrigation_plan(conditions, config)
    fertigation = fertigation_plan(plan, conditions.organic_carbon, conditions.area_ha, config)
    due = date.fromisoformat(plan["recommendation"]["next_irrigation_date"])
    sessions = schedule_pump(plan["recommendation"]["duration_hours"], due, config)
    facts = advisory_facts(plan, fertigation, sessions)
    return {
        "farm_id": str(record.get("Farm_ID", "unknown")),
        "soil_moisture_used": round(soil_moisture, 4),
        "soil_moisture_source": source,
        "soil_moisture_calibration": calibration,
        "plan": plan,
        "yield_loss_if_delayed": yield_loss_table(plan, config=config),
        "fertigation": fertigation,
        "pump_sessions": sessions,
        "facts": facts,
        "advisory_text": template_advisory(facts, language),
        "language": language,
    }
