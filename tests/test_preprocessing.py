from __future__ import annotations

import numpy as np

from src.data_loader import RAW_FEATURE_COLUMNS, TARGET_COLUMN, dataset_profile
from src.preprocessing import build_model_pipeline
from sklearn.ensemble import ExtraTreesRegressor


def test_dataset_loading_and_profile(source_data):
    profile = dataset_profile(source_data)
    assert profile["shape"] == {"rows": 1000, "columns": 16}
    assert profile["missing_values"]["NDVI"] == 6
    assert profile["target_candidates"] == [TARGET_COLUMN]


def test_missing_values_are_imputed_inside_pipeline(source_data):
    features = source_data[RAW_FEATURE_COLUMNS].head(40).copy()
    target = source_data[TARGET_COLUMN].head(40)
    features.loc[features.index[0], "NDVI"] = np.nan
    pipeline = build_model_pipeline(ExtraTreesRegressor(n_estimators=10, random_state=42))
    pipeline.fit(features, target)
    prediction = pipeline.predict(features.iloc[[0]])
    assert np.isfinite(prediction[0])

