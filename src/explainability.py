"""Optional SHAP explanations plus model-compatible deterministic fallbacks."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd


def _transformed_feature_names(pipeline: Any) -> list[str]:
    return [str(name) for name in pipeline.named_steps["preprocessor"].get_feature_names_out()]


def _model_importances(pipeline: Any) -> np.ndarray | None:
    model = pipeline.named_steps["model"]
    if hasattr(model, "feature_importances_"):
        return np.asarray(model.feature_importances_, dtype=float)
    if hasattr(model, "coef_"):
        return np.abs(np.ravel(model.coef_)).astype(float)
    return None


def global_feature_importance(pipeline: Any, reference_data: pd.DataFrame) -> pd.DataFrame:
    """Return global feature importance from SHAP when available, else model importance.

    The fallback is explicit rather than treating a different importance measure
    as a SHAP value.
    """
    engineered = pipeline.named_steps["feature_engineer"].transform(reference_data)
    transformed = pipeline.named_steps["preprocessor"].transform(engineered)
    names = _transformed_feature_names(pipeline)
    method = "model_importance"
    values: np.ndarray | None = None
    try:
        import shap  # type: ignore

        model = pipeline.named_steps["model"]
        shap_values = shap.TreeExplainer(model).shap_values(transformed)
        if isinstance(shap_values, list):
            shap_values = shap_values[0]
        values = np.mean(np.abs(np.asarray(shap_values)), axis=0)
        method = "shap"
    except Exception:
        values = _model_importances(pipeline)

    if values is None or len(values) != len(names):
        return pd.DataFrame(columns=["feature", "importance", "method"])
    result = pd.DataFrame({"feature": names, "importance": values, "method": method})
    return result.sort_values("importance", ascending=False, ignore_index=True)


def local_feature_contributions(
    pipeline: Any,
    record: pd.DataFrame,
    reference_row: dict[str, Any],
) -> dict[str, Any]:
    """Estimate local raw-feature effects by one-at-a-time baseline replacement.

    This is deliberately labelled as a local perturbation fallback. It is useful
    even for a non-SHAP-compatible estimator, but is not a causal statement.
    """
    if len(record) != 1:
        raise ValueError("Local explanation requires exactly one observation.")
    prediction = float(pipeline.predict(record)[0])
    contributions: list[dict[str, float | str]] = []
    for feature, baseline_value in reference_row.items():
        if feature not in record.columns:
            continue
        perturbed = record.copy()
        perturbed.loc[perturbed.index[0], feature] = baseline_value
        perturbed_prediction = float(pipeline.predict(perturbed)[0])
        contributions.append(
            {
                "feature": feature,
                "contribution": prediction - perturbed_prediction,
                "absolute_contribution": abs(prediction - perturbed_prediction),
            }
        )
    contributions.sort(key=lambda item: float(item["absolute_contribution"]), reverse=True)
    return {
        "method": "local_perturbation",
        "prediction": prediction,
        "contributions": contributions,
        "top_factors": [str(item["feature"]) for item in contributions[:5]],
    }

