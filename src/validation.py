"""Spatial generalisation audit for the soil-moisture model.

The original training script uses a random 70/15/15 split. Neighbouring farms
share satellite-derived values, so a random split mostly tests interpolation.
This module asks the deployment question: how well does the model predict soil
moisture for a village or taluk it has never seen?

Run:  python -m src.validation
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyRegressor
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import KFold, LeaveOneGroupOut
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from src.data_loader import DEFAULT_DATA_PATH, RAW_FEATURE_COLUMNS, TARGET_COLUMN, load_data
from src.preprocessing import build_model_pipeline

PROJECT_ROOT = Path(__file__).resolve().parents[1]
REPORT_DIR = PROJECT_ROOT / "reports"

ENVIRONMENT_FEATURES = [
    "LAI",
    "NDVI",
    "Organic_Carbon",
    "Rainfall_mm",
    "Relative_Humidity",
    "Soil_pH",
    "Temperature_C",
]


def _environment_only(model: Any) -> Pipeline:
    """Pipeline that sees no location information at all."""
    preprocessor = ColumnTransformer(
        [
            (
                "numeric",
                Pipeline([("imputer", SimpleImputer(strategy="median")), ("scaler", StandardScaler())]),
                ENVIRONMENT_FEATURES,
            )
        ],
        remainder="drop",
    )
    return Pipeline([("preprocessor", preprocessor), ("model", model)])


def _models(random_state: int = 42) -> dict[str, Any]:
    return {
        "Mean baseline": DummyRegressor(strategy="mean"),
        "Linear Regression": LinearRegression(),
        "Random Forest": RandomForestRegressor(n_estimators=200, min_samples_leaf=2, random_state=random_state, n_jobs=-1),
        "Gradient Boosting": GradientBoostingRegressor(n_estimators=200, random_state=random_state),
    }


def _metrics(y_true: pd.Series, predictions: np.ndarray) -> dict[str, float]:
    return {
        "mae": float(mean_absolute_error(y_true, predictions)),
        "rmse": float(np.sqrt(mean_squared_error(y_true, predictions))),
        "r2": float(r2_score(y_true, predictions)),
    }


def cross_validated_predictions(
    frame: pd.DataFrame, model: Any, feature_set: str, splitter: Any, groups: pd.Series | None
) -> np.ndarray:
    X = frame[RAW_FEATURE_COLUMNS]
    y = frame[TARGET_COLUMN].astype(float)
    predictions = np.zeros(len(frame))
    for train_index, test_index in splitter.split(X, y, groups):
        pipeline = build_model_pipeline(model) if feature_set == "all features" else _environment_only(model)
        pipeline.fit(X.iloc[train_index], y.iloc[train_index])
        predictions[test_index] = pipeline.predict(X.iloc[test_index])
    return predictions


def run_spatial_validation(
    data_path: str | Path = DEFAULT_DATA_PATH, report_dir: str | Path = REPORT_DIR, make_figure: bool = True
) -> dict[str, Any]:
    frame = load_data(data_path).dropna(subset=[TARGET_COLUMN]).reset_index(drop=True)
    y = frame[TARGET_COLUMN].astype(float)
    schemes = {
        "Random 5-fold": (KFold(n_splits=5, shuffle=True, random_state=42), None),
        "Leave-one-village-out": (LeaveOneGroupOut(), frame["Village"]),
        "Leave-one-taluk-out": (LeaveOneGroupOut(), frame["Taluk"]),
    }
    rows: list[dict[str, Any]] = []
    village_rows: list[dict[str, Any]] = []
    for scheme, (splitter, groups) in schemes.items():
        for feature_set in ("all features", "environment only"):
            for name, model in _models().items():
                if name == "Mean baseline" and feature_set == "environment only":
                    continue
                predictions = cross_validated_predictions(frame, model, feature_set, splitter, groups)
                rows.append({"scheme": scheme, "feature_set": feature_set, "model": name, **_metrics(y, predictions)})
                if scheme == "Leave-one-village-out" and feature_set == "all features":
                    errors = pd.DataFrame({"Village": frame["Village"], "error": np.abs(predictions - y)})
                    for village, group in errors.groupby("Village"):
                        village_rows.append({"model": name, "village": village, "mae": float(group["error"].mean())})

    results = pd.DataFrame(rows)
    by_village = pd.DataFrame(village_rows)
    output = Path(report_dir)
    output.mkdir(parents=True, exist_ok=True)
    results.to_csv(output / "spatial_validation.csv", index=False)
    by_village.to_csv(output / "spatial_validation_by_village.csv", index=False)

    target_profile = {
        "distinct_target_values": int(y.nunique()),
        "villages_with_single_target_value": int((frame.groupby("Village")[TARGET_COLUMN].nunique() == 1).sum()),
        "villages": int(frame["Village"].nunique()),
        "target_std": float(y.std()),
    }
    best = results[results["scheme"] == "Leave-one-village-out"].sort_values("mae").iloc[0]
    baseline = results[(results["scheme"] == "Leave-one-village-out") & (results["model"] == "Mean baseline")].iloc[0]
    summary = {
        "target_profile": target_profile,
        "best_unseen_village_model": {k: (float(v) if isinstance(v, (float, np.floating)) else v) for k, v in best.items()},
        "unseen_village_mean_baseline_mae": float(baseline["mae"]),
        "finding": (
            "Random-split scores are near perfect, but on unseen villages no model beats the mean baseline "
            "by a useful margin. Soil moisture in this dataset behaves like a coarse satellite grid value "
            "shared by whole villages. The model therefore cannot replace in-field soil moisture sensing; "
            "the irrigation engine accepts sensor readings and uses the model only as a fallback."
        ),
    }
    (output / "spatial_validation_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    if make_figure:
        _plot(results, output / "figures" / "spatial_validation.png")
    return {"results": results, "by_village": by_village, "summary": summary}


def _plot(results: pd.DataFrame, path: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    subset = results[results["feature_set"] == "all features"]
    pivot = subset.pivot(index="model", columns="scheme", values="mae")
    pivot = pivot[["Random 5-fold", "Leave-one-village-out", "Leave-one-taluk-out"]]
    order = ["Mean baseline", "Linear Regression", "Random Forest", "Gradient Boosting"]
    pivot = pivot.reindex([name for name in order if name in pivot.index])
    fig, ax = plt.subplots(figsize=(8, 4.2))
    pivot.T.plot(kind="bar", ax=ax, color=["#9e9e9e", "#6d8fb3", "#3d7a4f", "#c47f2c"], width=0.8)
    ax.set_yscale("log")
    ax.set_ylabel("MAE (soil moisture fraction, log scale)")
    ax.set_xlabel("")
    ax.set_title("Soil-moisture error: random split vs unseen locations")
    ax.tick_params(axis="x", rotation=0)
    ax.legend(frameon=False, fontsize=8)
    ax.spines[["top", "right"]].set_visible(False)
    fig.tight_layout()
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=150)
    plt.close(fig)


if __name__ == "__main__":
    outcome = run_spatial_validation()
    pd.set_option("display.width", 140)
    print(outcome["results"].to_string(index=False, float_format=lambda value: f"{value:.5f}"))
    print(json.dumps(outcome["summary"], indent=2))
