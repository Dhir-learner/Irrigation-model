"""Convert the ML/satellite soil-moisture estimate into a root-zone value the FAO-56 engine can use.

Why this exists
---------------
The dataset's soil moisture is a coarse satellite value: every farm lies between
about 0.217 and 0.256 m3/m3 and most villages share a single pixel value. FAO-56
field capacity and wilting point for the selectable soils span 0.11-0.36 m3/m3.
Feeding the satellite value straight into the water balance as an absolute
root-zone reading makes the soil dropdown decide the outcome for every farm
(sandy loam: all "not required"; clay: all "irrigate now") and erases the
farm-to-farm signal.

The prototype therefore treats the model value as a *relative wetness index*:
its percentile rank within the surveyed fleet (mid-rank for ties), mapped
linearly onto the available-water fraction of the selected soil. Probe readings
are true volumetric measurements and are never rescaled.

This is a documented prototype assumption, not a validated calibration.
Replace it with a probe-based regression once paired sensor data exist.
"""

from __future__ import annotations

from typing import Any, Sequence

import numpy as np

DEFAULTS = {
    "method": "percentile_rank",
    "available_fraction_at_driest": 0.30,
    "available_fraction_at_wettest": 0.95,
}


def calibration_config(config: dict[str, Any]) -> dict[str, Any]:
    return {**DEFAULTS, **(config.get("soil_moisture_calibration") or {})}


def percentile_rank(value: float, reference: Sequence[float]) -> float:
    """Mid-rank empirical CDF in [0, 1]; ties share the average of their ranks."""
    ordered = np.sort(np.asarray(reference, dtype=float))
    if ordered.size == 0:
        return 0.5
    left = np.searchsorted(ordered, value, side="left")
    right = np.searchsorted(ordered, value, side="right")
    return float(np.clip((left + right) / (2 * ordered.size), 0.0, 1.0))


def rootzone_moisture(
    model_value: float,
    reference: Sequence[float] | None,
    field_capacity: float,
    wilting_point: float,
    config: dict[str, Any],
) -> tuple[float, dict[str, Any]]:
    """Return (root-zone volumetric moisture, audit record) for a model estimate."""
    cfg = calibration_config(config)
    if cfg["method"] == "absolute" or reference is None or len(reference) == 0:
        return float(model_value), {"method": "absolute", "model_value": round(float(model_value), 4)}
    wetness = percentile_rank(float(model_value), reference)
    low = float(cfg["available_fraction_at_driest"])
    high = float(cfg["available_fraction_at_wettest"])
    available = low + (high - low) * wetness
    theta = wilting_point + available * (field_capacity - wilting_point)
    return float(theta), {
        "method": "percentile_rank",
        "model_value": round(float(model_value), 4),
        "relative_wetness": round(wetness, 3),
        "available_fraction": round(available, 3),
        "rootzone_moisture": round(theta, 4),
        "note": (
            "Satellite/ML soil moisture is ranked within the surveyed fleet and mapped onto the "
            "selected soil's available water. Prototype assumption; a probe reading overrides it."
        ),
    }
