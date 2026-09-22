"""Train, select and persist soil-moisture regression pipelines."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
import yaml
from sklearn.ensemble import ExtraTreesRegressor, GradientBoostingRegressor, RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split

from src.data_loader import DEFAULT_DATA_PATH, RAW_FEATURE_COLUMNS, TARGET_COLUMN, load_data
from src.explainability import global_feature_importance
from src.preprocessing import build_model_pipeline


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODEL_PATH = PROJECT_ROOT / "models" / "soil_moisture_pipeline.joblib"
DEFAULT_REPORT_DIR = PROJECT_ROOT / "reports"
DEFAULT_CONFIG_PATH = PROJECT_ROOT / "config.yaml"


def regression_metrics(y_true: pd.Series, predictions: np.ndarray) -> dict[str, float]:
    return {
        "mae": float(mean_absolute_error(y_true, predictions)),
        "rmse": float(np.sqrt(mean_squared_error(y_true, predictions))),
        "r2": float(r2_score(y_true, predictions)),
    }


def candidate_models(random_state: int) -> dict[str, Any]:
    models: dict[str, Any] = {
        "Linear Regression": LinearRegression(),
        "Random Forest": RandomForestRegressor(
            n_estimators=250, random_state=random_state, n_jobs=-1, min_samples_leaf=2
        ),
        "Extra Trees": ExtraTreesRegressor(
            n_estimators=250, random_state=random_state, n_jobs=-1, min_samples_leaf=2
        ),
        "Gradient Boosting": GradientBoostingRegressor(random_state=random_state, n_estimators=200),
    }
    try:
        from xgboost import XGBRegressor  # type: ignore

        models["XGBoost"] = XGBRegressor(
            n_estimators=250,
            learning_rate=0.05,
            max_depth=4,
            subsample=0.8,
            colsample_bytree=0.8,
            random_state=random_state,
            n_jobs=-1,
            objective="reg:squarederror",
        )
    except ImportError:
        pass
    return models


def _load_config(path: str | Path) -> dict[str, Any]:
    with Path(path).open("r", encoding="utf-8") as stream:
        return yaml.safe_load(stream) or {}


def _reference_row(frame: pd.DataFrame) -> dict[str, Any]:
    values: dict[str, Any] = {}
    for column in RAW_FEATURE_COLUMNS:
        if column == ".geo":
            # Missing geometry is imputed to the training median location in the fitted pipeline.
            values[column] = None
        elif pd.api.types.is_numeric_dtype(frame[column]):
            values[column] = float(pd.to_numeric(frame[column], errors="coerce").median())
        else:
            non_null = frame[column].dropna()
            values[column] = non_null.mode().iloc[0] if not non_null.empty else None
    return values


def train_models(
    data_path: str | Path = DEFAULT_DATA_PATH,
    model_path: str | Path = DEFAULT_MODEL_PATH,
    report_dir: str | Path = DEFAULT_REPORT_DIR,
    config_path: str | Path = DEFAULT_CONFIG_PATH,
) -> dict[str, Any]:
    """Train candidates on 70%, select on 15%, then test once on held-out 15%."""
    config = _load_config(config_path)
    random_state = int(config.get("model", {}).get("random_state", 42))
    test_size = float(config.get("model", {}).get("test_size", 0.15))
    validation_size = float(config.get("model", {}).get("validation_size", 0.15))
    if not 0 < test_size < 1 or not 0 < validation_size < 1 or test_size + validation_size >= 1:
        raise ValueError("test_size and validation_size must be positive and sum to less than 1.")

    df = load_data(data_path, require_target=True)
    initial_rows = len(df)
    df = df.drop_duplicates().dropna(subset=[TARGET_COLUMN]).reset_index(drop=True)
    if len(df) < 30:
        raise ValueError("At least 30 labelled observations are required for the configured split.")

    X = df[RAW_FEATURE_COLUMNS].copy()
    y = df[TARGET_COLUMN].astype(float)
    # No timestamp exists and Farm_ID is unique, so a group or temporal split is unsupported.
    X_train_val, X_test, y_train_val, y_test = train_test_split(
        X, y, test_size=test_size, random_state=random_state
    )
    validation_fraction_of_train_val = validation_size / (1 - test_size)
    X_train, X_validation, y_train, y_validation = train_test_split(
        X_train_val,
        y_train_val,
        test_size=validation_fraction_of_train_val,
        random_state=random_state,
    )

    comparisons: list[dict[str, Any]] = []
    fitted_candidates: dict[str, Any] = {}
    for name, estimator in candidate_models(random_state).items():
        pipeline = build_model_pipeline(estimator)
        pipeline.fit(X_train, y_train)
        validation_metrics = regression_metrics(y_validation, pipeline.predict(X_validation))
        comparisons.append({"model": name, **validation_metrics})
        fitted_candidates[name] = estimator

    comparison = pd.DataFrame(comparisons).sort_values(
        ["rmse", "mae", "r2"], ascending=[True, True, False], ignore_index=True
    )
    selected_name = str(comparison.loc[0, "model"])
    final_pipeline = build_model_pipeline(fitted_candidates[selected_name])
    final_pipeline.fit(X_train_val, y_train_val)
    test_metrics = regression_metrics(y_test, final_pipeline.predict(X_test))
    validation_metrics = comparison.loc[comparison["model"] == selected_name].iloc[0].drop("model").to_dict()

    trained_at = datetime.now(timezone.utc).isoformat()
    target_std = float(y_train_val.std())
    confidence_score = float(np.clip(1 - float(validation_metrics["rmse"]) / max(target_std, 1e-9), 0, 1))
    metadata = {
        "model_name": selected_name,
        "target": TARGET_COLUMN,
        "raw_feature_columns": RAW_FEATURE_COLUMNS,
        "feature_exclusions": {
            "system:index": "row identifier",
            "Farm_ID": "unique farm identifier",
            "District": "constant in supplied dataset",
            "Sampling_Method": "constant in supplied dataset",
            "Farm_Area_ha": "numerically constant apart from floating-point noise",
        },
        "split_strategy": (
            "Random 70/15/15 split (random_state=42). The dataset has no timestamp and each Farm_ID "
            "is unique. Spatially adjacent farms and shared village conditions may make this random "
            "hold-out optimistic; use spatial/temporal hold-outs when additional data is available."
        ),
        "training_rows": int(len(X_train_val)),
        "test_rows": int(len(X_test)),
        "source_rows_after_cleaning": int(len(df)),
        "source_rows_before_cleaning": int(initial_rows),
        "trained_at": trained_at,
        "validation_metrics": {key: float(value) for key, value in validation_metrics.items()},
        "test_metrics": test_metrics,
        "relative_confidence_score": confidence_score,
        "confidence_definition": (
            "1 - validation RMSE / training-target standard deviation, clipped to [0, 1]. "
            "It is a relative prototype fit score, not a calibrated probability."
        ),
        "reference_row": _reference_row(X_train_val),
    }
    artifact = {"pipeline": final_pipeline, "metadata": metadata}

    model_output = Path(model_path)
    report_output = Path(report_dir)
    model_output.parent.mkdir(parents=True, exist_ok=True)
    report_output.mkdir(parents=True, exist_ok=True)
    joblib.dump(artifact, model_output)
    comparison.to_csv(report_output / "model_comparison.csv", index=False)
    final_report = {
        "selected_model": selected_name,
        "validation_metrics": metadata["validation_metrics"],
        "test_metrics": test_metrics,
        "split_strategy": metadata["split_strategy"],
        "training_date": trained_at,
        "source_rows_after_cleaning": int(len(df)),
    }
    (report_output / "final_model_metrics.json").write_text(
        json.dumps(final_report, indent=2), encoding="utf-8"
    )
    importance = global_feature_importance(final_pipeline, X_train_val)
    importance.to_csv(report_output / "global_feature_importance.csv", index=False)

    return {
        "artifact_path": str(model_output),
        "report_dir": str(report_output),
        "comparison": comparison,
        "selected_model": selected_name,
        "validation_metrics": metadata["validation_metrics"],
        "test_metrics": test_metrics,
    }


if __name__ == "__main__":
    result = train_models()
    print("Validation model comparison")
    print(result["comparison"].to_string(index=False))
    print(f"\nSelected model: {result['selected_model']}")
    print("Final held-out test metrics:")
    print(json.dumps(result["test_metrics"], indent=2))
