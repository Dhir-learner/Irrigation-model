from __future__ import annotations

from pathlib import Path

import pytest

from src.data_loader import DEFAULT_DATA_PATH, load_data
from src.train import train_models


@pytest.fixture(scope="session")
def source_data():
    return load_data(DEFAULT_DATA_PATH)


@pytest.fixture(scope="session")
def trained_model_path(tmp_path_factory: pytest.TempPathFactory) -> Path:
    directory = tmp_path_factory.mktemp("trained_model")
    model_path = directory / "soil_moisture_pipeline.joblib"
    train_models(model_path=model_path, report_dir=directory / "reports")
    return model_path

