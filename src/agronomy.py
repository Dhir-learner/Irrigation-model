"""FAO-56 soil water balance engine for plot-level sugarcane irrigation advice.

This module is a transparent, rule-based decision-support engine. It is not a
trained ML model, because the supplied dataset has no labels for irrigation
dates, depths, durations, water stress or yield. Every coefficient comes from a
published reference (FAO Irrigation and Drainage Papers 56 and 33) or from a
clearly labelled prototype assumption in ``config.yaml``.

Use-case models covered here:
    * Crop water requirement (ETc = Kc x ETo)
    * Next irrigation date (daily root-zone depletion projection)
    * Irrigation depth, volume and pump duration
    * Rainfall-adjusted irrigation recommendation
    * Water stress index (FAO-56 Ks coefficient)
    * Yield loss due to delayed irrigation (FAO-33 Ky relationship)
    * Fertigation recommendation (stage-split NPK with organic-carbon adjustment)
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

from src.advisory import load_config

STAGES = ("initial", "development", "mid", "late")
STAGE_LABELS = {
    "initial": "Germination / establishment",
    "development": "Tillering",
    "mid": "Grand growth",
    "late": "Maturity / ripening",
}


@dataclass
class FarmConditions:
    """Inputs for one plot. Soil moisture is volumetric (m3/m3)."""

    soil_moisture: float
    temperature_c: float
    latitude: float
    area_ha: float
    crop_age_days: int
    soil_type: str | None = None
    irrigation_method: str | None = None
    pump_flow_m3h: float | None = None
    forecast_rain_mm: list[float] = field(default_factory=list)
    forecast_temp_c: list[float] = field(default_factory=list)
    forecast_eto_mm: list[float] = field(default_factory=list)
    organic_carbon: float | None = None
    start_date: date | None = None


def agronomy_config(config: dict[str, Any] | None = None) -> dict[str, Any]:
    return (config or load_config())["agronomy"]


# --------------------------------------------------------------------------- crop


def crop_stage(age_days: int, cfg: dict[str, Any]) -> tuple[str, float]:
    """Return the FAO-56 growth stage and interpolated single crop coefficient."""
    days = cfg["stage_days"]
    kc = cfg["kc"]
    age = max(0, int(age_days))
    end_initial = days["initial"]
    end_development = end_initial + days["development"]
    end_mid = end_development + days["mid"]
    end_late = end_mid + days["late"]
    if age < end_initial:
        return "initial", float(kc["initial"])
    if age < end_development:
        fraction = (age - end_initial) / days["development"]
        return "development", float(kc["initial"] + fraction * (kc["mid"] - kc["initial"]))
    if age < end_mid:
        return "mid", float(kc["mid"])
    fraction = min(1.0, (age - end_mid) / days["late"]) if age < end_late else 1.0
    return "late", float(kc["mid"] + fraction * (kc["end"] - kc["mid"]))


def root_depth_m(age_days: int, cfg: dict[str, Any]) -> float:
    """Linear root growth from planting to the start of mid-season (FAO-56 ch. 8)."""
    days = cfg["stage_days"]
    full_depth_at = days["initial"] + days["development"]
    fraction = min(1.0, max(0.0, age_days / full_depth_at))
    lower, upper = cfg["root_depth_m"]["min"], cfg["root_depth_m"]["max"]
    return float(lower + fraction * (upper - lower))


# ---------------------------------------------------------------------- weather


def daylight_hours(latitude_deg: float, day_of_year: int) -> float:
    """Maximum daylight hours N (FAO-56 equations 24, 25 and 34)."""
    phi = math.radians(latitude_deg)
    declination = 0.409 * math.sin(2 * math.pi * day_of_year / 365 - 1.39)
    argument = max(-1.0, min(1.0, -math.tan(phi) * math.tan(declination)))
    sunset_angle = math.acos(argument)
    return 24 / math.pi * sunset_angle


def eto_blaney_criddle(temperature_c: float, latitude_deg: float, day_of_year: int) -> float:
    """Reference evapotranspiration (mm/day) by the FAO Blaney-Criddle method.

    ETo = p (0.46 T + 8.13), where p is the day's share of annual daytime hours.
    The method needs only mean temperature and latitude, which is what the
    dataset provides. When a forecast service supplies Penman-Monteith ETo, the
    caller passes it through ``forecast_eto_mm`` and this estimate is skipped.
    """
    p = 100 * daylight_hours(latitude_deg, day_of_year) / (365 * 12)
    return max(0.0, p * (0.46 * temperature_c + 8.13))


def effective_rain(rain_mm: float, cfg: dict[str, Any]) -> float:
    """Prototype rule: light showers are ignored, the rest is discounted for runoff."""
    if rain_mm < cfg["min_effective_rain_mm"]:
        return 0.0
    return float(rain_mm * cfg["effective_rain_fraction"])


# ------------------------------------------------------------------ water balance


def adjusted_depletion_fraction(p_table: float, etc_mm: float) -> float:
    """FAO-56 Table 22 footnote: p = p_table + 0.04 (5 - ETc), bounded 0.1-0.8."""
    return float(min(0.8, max(0.1, p_table + 0.04 * (5 - etc_mm))))


def water_stress_coefficient(depletion: float, taw: float, raw: float) -> float:
    """FAO-56 equation 84: Ks = (TAW - Dr) / ((1 - p) TAW) once Dr exceeds RAW."""
    if depletion <= raw:
        return 1.0
    if taw <= raw:
        return 0.0
    return float(max(0.0, min(1.0, (taw - depletion) / (taw - raw))))


def stress_category(ks: float) -> str:
    if ks >= 0.999:
        return "NONE"
    if ks >= 0.8:
        return "MILD"
    if ks >= 0.5:
        return "MODERATE"
    return "SEVERE"


def _soil(cfg: dict[str, Any], soil_type: str | None) -> tuple[str, float, float]:
    name = soil_type if soil_type in cfg["soils"] else cfg["default_soil"]
    soil = cfg["soils"][name]
    return name, float(soil["field_capacity"]), float(soil["wilting_point"])


def _series(values: list[float], index: int, default: float) -> float:
    if index < len(values) and values[index] is not None:
        return float(values[index])
    return float(default)


def irrigation_plan(conditions: FarmConditions, config: dict[str, Any] | None = None) -> dict[str, Any]:
    """Build a complete plot-level irrigation plan from the FAO-56 water balance."""
    full_config = config or load_config()
    cfg = agronomy_config(full_config)
    start = conditions.start_date or date.today()
    horizon = int(cfg["forecast_horizon_days"])

    stage, kc = crop_stage(conditions.crop_age_days, cfg)
    zr = root_depth_m(conditions.crop_age_days, cfg)
    soil_name, fc, wp = _soil(cfg, conditions.soil_type)
    taw = 1000 * (fc - wp) * zr

    theta = float(conditions.soil_moisture)
    depletion_now = float(min(taw, max(0.0, 1000 * (fc - theta) * zr)))

    doy = start.timetuple().tm_yday
    eto_today = _series(
        conditions.forecast_eto_mm, 0, eto_blaney_criddle(conditions.temperature_c, conditions.latitude, doy)
    )
    etc_today = kc * eto_today
    p = adjusted_depletion_fraction(float(cfg["depletion_fraction_p"]), etc_today)
    raw = p * taw
    ks_now = water_stress_coefficient(depletion_now, taw, raw)

    def project(with_rain: bool) -> list[dict[str, Any]]:
        rows = []
        depletion = depletion_now
        for day in range(horizon):
            current = start + timedelta(days=day)
            day_of_year = current.timetuple().tm_yday
            temperature = _series(conditions.forecast_temp_c, day, conditions.temperature_c)
            eto = _series(
                conditions.forecast_eto_mm,
                day,
                eto_blaney_criddle(temperature, conditions.latitude, day_of_year),
            )
            age = conditions.crop_age_days + day
            _, kc_day = crop_stage(age, cfg)
            etc = kc_day * eto
            rain = _series(conditions.forecast_rain_mm, day, 0.0) if with_rain else 0.0
            rain_effective = effective_rain(rain, cfg)
            ks = water_stress_coefficient(depletion, taw, raw)
            rows.append(
                {
                    "date": current.isoformat(),
                    "day": day,
                    "temperature_c": round(temperature, 2),
                    "eto_mm": round(eto, 2),
                    "etc_mm": round(etc, 2),
                    "rain_mm": round(rain, 1),
                    "effective_rain_mm": round(rain_effective, 1),
                    "depletion_start_mm": round(depletion, 1),
                    "ks": round(ks, 3),
                }
            )
            depletion = min(taw, max(0.0, depletion + ks * etc - rain_effective))
        return rows

    projection = project(with_rain=True)
    dry_projection = project(with_rain=False)

    def first_due(rows: list[dict[str, Any]]) -> int | None:
        for row in rows:
            if row["depletion_start_mm"] >= raw:
                return int(row["day"])
        return None

    due_day = first_due(projection)
    dry_due_day = first_due(dry_projection)
    rain_total = float(sum(conditions.forecast_rain_mm[:horizon])) if conditions.forecast_rain_mm else 0.0

    if due_day is None:
        # Not due inside the horizon: extrapolate with today's ETc and no rain.
        last = projection[-1]
        remaining = max(0.0, raw - last["depletion_start_mm"])
        due_day = horizon + int(math.ceil(remaining / max(etc_today, 0.1)))
    if dry_due_day is None:
        last = dry_projection[-1]
        remaining = max(0.0, raw - last["depletion_start_mm"])
        dry_due_day = horizon + int(math.ceil(remaining / max(etc_today, 0.1)))

    due_date = start + timedelta(days=due_day)
    depletion_at_due = (
        projection[due_day]["depletion_start_mm"] if due_day < len(projection) else raw
    )

    method = conditions.irrigation_method if conditions.irrigation_method in cfg["irrigation_efficiency"] else cfg["default_method"]
    efficiency = float(cfg["irrigation_efficiency"][method])
    pump_flow = float(conditions.pump_flow_m3h or cfg["default_pump_flow_m3h"])
    net_depth = float(max(depletion_at_due, 0.0))
    gross_depth = net_depth / efficiency
    volume_m3 = gross_depth * conditions.area_ha * 10  # 1 mm over 1 ha = 10 m3
    duration_h = volume_m3 / pump_flow if pump_flow > 0 else float("nan")

    postponed_days = max(0, due_day - dry_due_day)
    if depletion_now >= raw:
        status = "IRRIGATE_NOW"
    elif due_day <= 3:
        status = "IRRIGATE_SOON"
    else:
        status = "NOT_REQUIRED"

    return {
        "method_note": (
            "FAO-56 soil water balance with prototype parameters. A rule-based estimate, "
            "not a trained prediction and not a validated prescription."
        ),
        "inputs": {
            "soil_moisture": theta,
            "temperature_c": conditions.temperature_c,
            "latitude": conditions.latitude,
            "area_ha": conditions.area_ha,
            "crop_age_days": conditions.crop_age_days,
            "soil_type": soil_name,
            "irrigation_method": method,
            "pump_flow_m3h": pump_flow,
            "forecast_rain_total_mm": round(rain_total, 1),
            "eto_source": "forecast (Penman-Monteith)" if conditions.forecast_eto_mm else "Blaney-Criddle estimate",
        },
        "crop": {
            "stage": stage,
            "stage_label": STAGE_LABELS[stage],
            "kc": round(kc, 3),
            "root_depth_m": round(zr, 2),
        },
        "water_requirement": {
            "eto_mm_day": round(eto_today, 2),
            "etc_mm_day": round(etc_today, 2),
            "etc_m3_day": round(etc_today * conditions.area_ha * 10, 1),
            "horizon_etc_mm": round(sum(row["etc_mm"] for row in projection), 1),
        },
        "soil_water": {
            "field_capacity": fc,
            "wilting_point": wp,
            "taw_mm": round(taw, 1),
            "raw_mm": round(raw, 1),
            "depletion_fraction_p": round(p, 3),
            "depletion_mm": round(depletion_now, 1),
            "depletion_ratio": round(depletion_now / taw, 3) if taw else 0.0,
        },
        "water_stress": {
            "ks": round(ks_now, 3),
            "stress_index": round(1 - ks_now, 3),
            "category": stress_category(ks_now),
            "days_until_stress": due_day,
        },
        "recommendation": {
            "status": status,
            "next_irrigation_date": due_date.isoformat(),
            "days_until_irrigation": due_day,
            "net_depth_mm": round(net_depth, 1),
            "gross_depth_mm": round(gross_depth, 1),
            "volume_m3": round(volume_m3, 1),
            "duration_hours": round(duration_h, 2),
            "application_efficiency": efficiency,
        },
        "rainfall_adjustment": {
            "forecast_rain_mm": round(rain_total, 1),
            "due_day_without_rain": dry_due_day,
            "due_day_with_rain": due_day,
            "postponed_days": postponed_days,
        },
        "projection": projection,
    }


# ----------------------------------------------------------------- yield loss


def yield_loss_for_delay(
    plan: dict[str, Any], delay_days: int, config: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Relative yield loss if irrigation is delayed past the due date (FAO-33).

    Stage loss = Ky_stage x (1 - ETa/ETm), where the ET deficit accumulated
    during the delay is compared with the crop's ET demand over that stage.
    """
    cfg = agronomy_config(config)
    stage = plan["crop"]["stage"]
    taw = plan["soil_water"]["taw_mm"]
    raw = plan["soil_water"]["raw_mm"]
    etc = max(plan["water_requirement"]["etc_mm_day"], 0.01)
    depletion = raw  # the delay starts on the day irrigation becomes due
    deficit = 0.0
    for _ in range(max(0, int(delay_days))):
        ks = water_stress_coefficient(depletion, taw, raw)
        actual = ks * etc
        deficit += etc - actual
        depletion = min(taw, depletion + actual)
    stage_demand = etc * float(cfg["stage_days"][stage])
    ky = float(cfg["ky"][stage])
    loss = min(1.0, ky * deficit / stage_demand) if stage_demand else 0.0
    return {
        "delay_days": int(delay_days),
        "et_deficit_mm": round(deficit, 1),
        "ky": ky,
        "relative_yield_loss_pct": round(100 * loss, 2),
        "final_ks": round(water_stress_coefficient(depletion, taw, raw), 3),
    }


def yield_loss_table(plan: dict[str, Any], delays: tuple[int, ...] = (0, 3, 5, 7, 10, 15), config: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    return [yield_loss_for_delay(plan, delay, config) for delay in delays]


# ---------------------------------------------------------------- fertigation


def organic_carbon_rating(organic_carbon: float | None, cfg: dict[str, Any]) -> str:
    thresholds = cfg["fertigation"]["organic_carbon_g_kg"]
    if organic_carbon is None or organic_carbon != organic_carbon:
        return "medium"
    if organic_carbon < thresholds["low_below"]:
        return "low"
    if organic_carbon > thresholds["high_above"]:
        return "high"
    return "medium"


def fertigation_plan(
    plan: dict[str, Any], organic_carbon: float | None, area_ha: float, config: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Stage-split NPK dose converted to common fertilizers, per hectare and per acre.

    Products: water-soluble MAP (12-61-0) supplies P2O5 and some N, urea (46% N)
    supplies the remaining N, and muriate of potash (60% K2O) supplies K2O.
    """
    cfg = agronomy_config(config)
    fert = cfg["fertigation"]
    stage = plan["crop"]["stage"]
    interval = int(fert.get("interval_days", 15))
    applications = max(1, math.ceil(cfg["stage_days"][stage] / interval))
    rating = organic_carbon_rating(organic_carbon, cfg)
    n_factor = float(fert["nitrogen_adjustment"][rating])

    split = fert["stage_split"][stage]
    seasonal = fert["seasonal_npk_kg_ha"]
    stage_nutrients = {
        "N": seasonal["N"] * split["N"] * n_factor,
        "P2O5": seasonal["P2O5"] * split["P2O5"],
        "K2O": seasonal["K2O"] * split["K2O"],
    }
    per_application = {key: value / applications for key, value in stage_nutrients.items()}
    map_kg = per_application["P2O5"] / 0.61
    urea_kg = max(0.0, (per_application["N"] - 0.12 * map_kg) / 0.46)
    mop_kg = per_application["K2O"] / 0.60
    products_ha = {"Urea": urea_kg, "MAP (12-61-0)": map_kg, "MOP": mop_kg}
    hectares_per_acre = 0.4047
    return {
        "method_note": (
            "Stage-split NPK schedule using placeholder seasonal doses from config.yaml. "
            "Replace with the KIAAR / UAS soil-test recommendation before use."
        ),
        "stage": stage,
        "organic_carbon_rating": rating,
        "nitrogen_adjustment_factor": n_factor,
        "applications_in_stage": applications,
        "next_fertigation_date": plan["recommendation"]["next_irrigation_date"],
        "timing_note": "Apply with or immediately after the next irrigation, preferably in the morning.",
        "nutrients_per_application_kg_ha": {key: round(value, 2) for key, value in per_application.items()},
        "products_per_application_kg_ha": {key: round(value, 2) for key, value in products_ha.items()},
        "products_per_application_kg_acre": {
            key: round(value * hectares_per_acre, 2) for key, value in products_ha.items()
        },
        "products_per_application_kg_plot": {
            key: round(value * area_ha, 2) for key, value in products_ha.items()
        },
    }
