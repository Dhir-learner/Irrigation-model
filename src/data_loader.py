"""Dataset ingestion, validation and profiling utilities."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_PATH = PROJECT_ROOT / "data" / "IrrigationAdvisoryDataset.csv"
TARGET_COLUMN = "Soil_Moisture"

RAW_FEATURE_COLUMNS = [
    "LAI",
    "NDVI",
    "Organic_Carbon",
    "Rainfall_mm",
    "Relative_Humidity",
    "Soil_pH",
    "Temperature_C",
    "Taluk",
    "Village",
    ".geo",
]

IDENTIFIER_OR_NONPREDICTIVE_COLUMNS = [
    "system:index",
    "Farm_ID",
    "District",  # one value in the supplied data
    "Sampling_Method",  # one value in the supplied data
]

NUMERIC_VALID_RANGES: dict[str, tuple[float | None, float | None]] = {
    "Farm_Area_ha": (0, None),
    "LAI": (0, None),
    "NDVI": (-1, 1),
    "Organic_Carbon": (0, None),
    "Rainfall_mm": (0, None),
    "Relative_Humidity": (0, 100),
    "Soil_Moisture": (0, 1),
    "Soil_pH": (0, 14),
    "Temperature_C": (-60, 70),
}


def load_data(path: str | Path = DEFAULT_DATA_PATH, require_target: bool = True) -> pd.DataFrame:
    """Read the supplied CSV and make malformed numeric values missing.

    Rows are not silently dropped here: target handling belongs to training and
    feature imputation belongs to the fitted scikit-learn pipeline.
    """
    data_path = Path(path)
    if not data_path.exists():
        raise FileNotFoundError(f"Dataset not found: {data_path}")

    try:
        df = pd.read_csv(data_path, on_bad_lines="warn")
    except UnicodeDecodeError:
        df = pd.read_csv(data_path, encoding="latin-1", on_bad_lines="warn")

    required = set(RAW_FEATURE_COLUMNS)
    if require_target:
        required.add(TARGET_COLUMN)
    missing_columns = sorted(required.difference(df.columns))
    if missing_columns:
        raise ValueError(f"Dataset is missing required columns: {missing_columns}")

    for column, (lower, upper) in NUMERIC_VALID_RANGES.items():
        if column not in df.columns:
            continue
        values = pd.to_numeric(df[column], errors="coerce")
        invalid = pd.Series(False, index=df.index)
        if lower is not None:
            invalid |= values < lower
        if upper is not None:
            invalid |= values > upper
        df[column] = values.mask(invalid, np.nan)

    return df


def dataset_profile(df: pd.DataFrame) -> dict[str, Any]:
    """Return a JSON-serializable source-of-truth dataset profile."""
    numeric = df.select_dtypes(include="number")
    categorical = df.select_dtypes(exclude="number")
    categorical_values = {
        column: [str(value) for value in df[column].dropna().unique()[:30]]
        for column in categorical.columns
    }
    return {
        "shape": {"rows": int(df.shape[0]), "columns": int(df.shape[1])},
        "columns": list(df.columns),
        "dtypes": {column: str(dtype) for column, dtype in df.dtypes.items()},
        "missing_values": {column: int(value) for column, value in df.isna().sum().items()},
        "unique_counts": {column: int(value) for column, value in df.nunique(dropna=True).items()},
        "duplicate_rows": int(df.duplicated().sum()),
        "numerical_summary": json.loads(numeric.describe().T.to_json(orient="index")),
        "categorical_values": categorical_values,
        "target_candidates": [TARGET_COLUMN] if TARGET_COLUMN in df.columns else [],
    }


def save_dataset_profile(df: pd.DataFrame, output_path: str | Path) -> Path:
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(dataset_profile(df), indent=2), encoding="utf-8")
    return output
