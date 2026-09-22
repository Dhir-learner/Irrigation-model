"""Feature engineering using only columns supplied with each observation."""

from __future__ import annotations

import json
from typing import Any

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, TransformerMixin


NUMERIC_FEATURES = [
    "LAI",
    "NDVI",
    "Organic_Carbon",
    "Rainfall_mm",
    "Relative_Humidity",
    "Soil_pH",
    "Temperature_C",
    "Longitude",
    "Latitude",
    "Rainfall_Temperature_Interaction",
    "Humidity_Temperature_Interaction",
]
CATEGORICAL_FEATURES = ["Taluk", "Village"]


def _coordinate_pairs(value: Any) -> list[tuple[float, float]]:
    """Extract GeoJSON coordinate pairs without inventing geometry."""
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError):
            return []
    if not isinstance(value, dict):
        return []
    coordinates = value.get("coordinates")
    pairs: list[tuple[float, float]] = []

    def visit(item: Any) -> None:
        if not isinstance(item, (list, tuple)):
            return
        if len(item) >= 2 and isinstance(item[0], (int, float)) and isinstance(item[1], (int, float)):
            pairs.append((float(item[0]), float(item[1])))
            return
        for nested in item:
            visit(nested)

    visit(coordinates)
    return pairs


def geometry_center(value: Any) -> tuple[float, float]:
    """Return the bounding-box center of a valid GeoJSON geometry, else NaNs."""
    pairs = _coordinate_pairs(value)
    if not pairs:
        return np.nan, np.nan
    longitudes, latitudes = zip(*pairs)
    return (min(longitudes) + max(longitudes)) / 2, (min(latitudes) + max(latitudes)) / 2


def parse_geometry(value: Any) -> dict[str, Any] | None:
    """Return a GeoJSON mapping only when it is valid enough to display."""
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError):
            return None
    if not isinstance(value, dict) or not value.get("type") or not _coordinate_pairs(value):
        return None
    return value


class FarmFeatureEngineer(BaseEstimator, TransformerMixin):
    """Derive transparent environmental and location features inside the pipeline."""

    def fit(self, X: pd.DataFrame, y: pd.Series | None = None) -> "FarmFeatureEngineer":
        return self

    def transform(self, X: pd.DataFrame) -> pd.DataFrame:
        if not isinstance(X, pd.DataFrame):
            X = pd.DataFrame(X)
        frame = X.copy()
        for column in ["Rainfall_mm", "Temperature_C", "Relative_Humidity"]:
            if column not in frame:
                frame[column] = np.nan
            frame[column] = pd.to_numeric(frame[column], errors="coerce")

        if ".geo" in frame:
            centers = frame[".geo"].map(geometry_center)
            frame["Longitude"] = centers.map(lambda pair: pair[0])
            frame["Latitude"] = centers.map(lambda pair: pair[1])
        else:
            frame["Longitude"] = np.nan
            frame["Latitude"] = np.nan

        frame["Rainfall_Temperature_Interaction"] = frame["Rainfall_mm"] * frame["Temperature_C"]
        frame["Humidity_Temperature_Interaction"] = frame["Relative_Humidity"] * frame["Temperature_C"]
        return frame.drop(columns=[".geo"], errors="ignore")
