"""Optional live weather forecast from the free Open-Meteo API (no key needed).

Only the farm centroid (latitude/longitude, rounded to 3 decimals, about 100 m)
is sent. The call is opt-in from the dashboard/API; tests never hit the network.
Open-Meteo's daily ``et0_fao_evapotranspiration`` is FAO-56 Penman-Monteith ETo,
which replaces the Blaney-Criddle estimate when available.
"""

from __future__ import annotations

import json
from typing import Any
from urllib.parse import urlencode
from urllib.request import urlopen

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"


def parse_open_meteo(payload: dict[str, Any]) -> dict[str, list[Any]]:
    daily = payload.get("daily", {})
    maxima = daily.get("temperature_2m_max", [])
    minima = daily.get("temperature_2m_min", [])
    mean = [
        (high + low) / 2 if high is not None and low is not None else None
        for high, low in zip(maxima, minima)
    ]
    return {
        "dates": list(daily.get("time", [])),
        "temperature_c": mean,
        "rain_mm": [value or 0.0 for value in daily.get("precipitation_sum", [])],
        "eto_mm": list(daily.get("et0_fao_evapotranspiration", [])),
        "rain_probability_pct": list(daily.get("precipitation_probability_max", [])),
    }


def fetch_forecast(latitude: float, longitude: float, days: int = 14, timeout: float = 10.0) -> dict[str, list[Any]]:
    query = urlencode(
        {
            "latitude": round(latitude, 3),
            "longitude": round(longitude, 3),
            "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,"
            "precipitation_probability_max,et0_fao_evapotranspiration",
            "forecast_days": max(1, min(16, days)),
            "timezone": "Asia/Kolkata",
        }
    )
    with urlopen(f"{FORECAST_URL}?{query}", timeout=timeout) as response:  # noqa: S310 - fixed https host
        return parse_open_meteo(json.loads(response.read().decode("utf-8")))
