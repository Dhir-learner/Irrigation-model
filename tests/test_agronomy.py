from __future__ import annotations

from datetime import date

import pytest

from src.advisory import load_config
from src.agronomy import (
    FarmConditions,
    crop_stage,
    daylight_hours,
    eto_blaney_criddle,
    fertigation_plan,
    irrigation_plan,
    water_stress_coefficient,
    yield_loss_for_delay,
)

START = date(2026, 9, 30)


def _conditions(**overrides):
    values = dict(
        soil_moisture=0.218, temperature_c=23.3, latitude=12.44, area_ha=0.74, crop_age_days=180, start_date=START
    )
    values.update(overrides)
    return FarmConditions(**values)


def test_crop_stages_follow_fao56_sugarcane_coefficients():
    cfg = load_config()["agronomy"]
    assert crop_stage(10, cfg) == ("initial", 0.40)
    stage, kc = crop_stage(65, cfg)
    assert stage == "development" and 0.40 < kc < 1.25
    assert crop_stage(200, cfg) == ("mid", 1.25)
    assert crop_stage(500, cfg)[1] == pytest.approx(0.75)


def test_daylight_and_eto_are_physically_plausible():
    # Near 12 degrees north, daylight stays close to 12 hours all year.
    assert 11.0 < daylight_hours(12.44, 1) < 12.5
    assert 12.0 < daylight_hours(12.44, 172) < 13.0
    assert 3.5 < eto_blaney_criddle(23.3, 12.44, 273) < 7.0


def test_water_stress_coefficient_matches_fao56_equation_84():
    assert water_stress_coefficient(50, 144, 90) == 1.0
    assert water_stress_coefficient(117, 144, 90) == pytest.approx(0.5)
    assert water_stress_coefficient(144, 144, 90) == 0.0


def test_dry_soil_triggers_immediate_irrigation_with_consistent_volume():
    plan = irrigation_plan(_conditions(soil_moisture=0.14))
    rec = plan["recommendation"]
    assert rec["status"] == "IRRIGATE_NOW"
    assert rec["days_until_irrigation"] == 0
    assert plan["water_stress"]["category"] in {"MILD", "MODERATE", "SEVERE"}
    assert rec["volume_m3"] == pytest.approx(rec["gross_depth_mm"] * 0.74 * 10, rel=0.01)
    assert rec["duration_hours"] == pytest.approx(rec["volume_m3"] / plan["inputs"]["pump_flow_m3h"], rel=0.01)


def test_wetter_soil_delays_irrigation():
    dry = irrigation_plan(_conditions(soil_moisture=0.20))
    wet = irrigation_plan(_conditions(soil_moisture=0.23))
    assert wet["recommendation"]["days_until_irrigation"] > dry["recommendation"]["days_until_irrigation"]


def test_forecast_rain_postpones_irrigation():
    plan = irrigation_plan(_conditions(forecast_rain_mm=[0, 0, 25, 20, 0]))
    assert plan["rainfall_adjustment"]["postponed_days"] > 0
    light = irrigation_plan(_conditions(forecast_rain_mm=[2, 3, 1]))
    assert light["rainfall_adjustment"]["postponed_days"] == 0


def test_drip_needs_less_water_than_flood():
    drip = irrigation_plan(_conditions(irrigation_method="drip"))
    flood = irrigation_plan(_conditions(irrigation_method="flood"))
    assert drip["recommendation"]["gross_depth_mm"] < flood["recommendation"]["gross_depth_mm"]


def test_yield_loss_grows_with_delay():
    plan = irrigation_plan(_conditions())
    losses = [yield_loss_for_delay(plan, days)["relative_yield_loss_pct"] for days in (0, 5, 10)]
    assert losses[0] == 0
    assert losses[0] < losses[1] < losses[2]


def test_fertigation_converts_nutrients_to_products():
    plan = irrigation_plan(_conditions())
    fert = fertigation_plan(plan, organic_carbon=4.0, area_ha=0.74)
    assert fert["organic_carbon_rating"] == "low"
    assert fert["nitrogen_adjustment_factor"] > 1
    products = fert["products_per_application_kg_ha"]
    nutrients = fert["nutrients_per_application_kg_ha"]
    assert products["MOP"] * 0.60 == pytest.approx(nutrients["K2O"], abs=0.02)
    supplied_n = products["Urea"] * 0.46 + products["MAP (12-61-0)"] * 0.12
    assert supplied_n == pytest.approx(nutrients["N"], abs=0.02)


def test_percentile_rank_calibration_maps_onto_available_water():
    from src.calibration import percentile_rank, rootzone_moisture

    reference = [0.21, 0.21, 0.22, 0.25]
    assert percentile_rank(0.21, reference) == 0.25  # mid-rank of the tied pair
    assert percentile_rank(0.30, reference) == 1.0
    config = {"soil_moisture_calibration": {"method": "percentile_rank", "available_fraction_at_driest": 0.3, "available_fraction_at_wettest": 0.9}}
    theta, info = rootzone_moisture(0.25, reference, field_capacity=0.30, wilting_point=0.10, config=config)
    assert info["relative_wetness"] == 0.875
    assert abs(theta - (0.10 + (0.3 + 0.6 * 0.875) * 0.20)) < 1e-9
    absolute, info = rootzone_moisture(0.25, reference, 0.30, 0.10, {"soil_moisture_calibration": {"method": "absolute"}})
    assert absolute == 0.25 and info["method"] == "absolute"


def test_forecast_gaps_keep_later_days_on_their_dates():
    from src.decision import farm_decision

    farm = {"Farm_ID": "F", "Temperature_C": 25.0, "Farm_Area_ha": 1.0, ".geo": None}
    result = farm_decision(farm, None, 180, sensor_soil_moisture=0.2, forecast={"rain_mm": [0, 0, 30], "temperature_c": [None, 30.0, 30.0]})
    projection = result["plan"]["projection"]
    assert projection[0]["temperature_c"] == 25.0  # gap falls back to the record value
    assert projection[1]["temperature_c"] == 30.0  # not shifted onto day 0
    assert projection[2]["rain_mm"] == 30.0
