"""SQLite persistence for prototype prediction and simulation logs."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB_PATH = PROJECT_ROOT / "database" / "app.db"


def initialize_database(path: str | Path = DEFAULT_DB_PATH) -> Path:
    db_path = Path(path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS prediction_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                farm_id TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                input_features TEXT NOT NULL,
                prediction REAL NOT NULL,
                risk_level TEXT NOT NULL,
                advisory TEXT NOT NULL,
                model_version TEXT NOT NULL,
                event_type TEXT NOT NULL
            )
            """
        )
    return db_path


def log_prediction(
    result: dict[str, Any],
    input_features: dict[str, Any],
    model_version: str,
    event_type: str = "prediction",
    path: str | Path = DEFAULT_DB_PATH,
) -> None:
    db_path = initialize_database(path)
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            """
            INSERT INTO prediction_logs
            (farm_id, timestamp, input_features, prediction, risk_level, advisory, model_version, event_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                result["farm_id"],
                result["timestamp"],
                json.dumps(input_features, default=str),
                result["predicted_soil_moisture"],
                result["risk_level"],
                json.dumps(result, default=str),
                model_version,
                event_type,
            ),
        )

