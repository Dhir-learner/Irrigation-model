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



def initialize_feedback_table(path: str | Path = DEFAULT_DB_PATH) -> Path:
    """Human-in-the-loop log: whether an advisory was accepted, modified or rejected."""
    db_path = initialize_database(path)
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS advisory_feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                farm_id TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                reviewer_role TEXT NOT NULL,
                decision TEXT NOT NULL CHECK (decision IN ('accepted', 'modified', 'rejected')),
                recommended_date TEXT,
                recommended_hours REAL,
                override_date TEXT,
                override_hours REAL,
                comment TEXT,
                soil_moisture_source TEXT
            )
            """
        )
    return db_path


def log_feedback(entry: dict[str, Any], path: str | Path = DEFAULT_DB_PATH) -> int:
    from datetime import datetime, timezone

    db_path = initialize_feedback_table(path)
    with sqlite3.connect(db_path) as connection:
        cursor = connection.execute(
            """
            INSERT INTO advisory_feedback
            (farm_id, timestamp, reviewer_role, decision, recommended_date, recommended_hours,
             override_date, override_hours, comment, soil_moisture_source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                entry["farm_id"],
                entry.get("timestamp") or datetime.now(timezone.utc).isoformat(),
                entry.get("reviewer_role", "field_officer"),
                entry["decision"],
                entry.get("recommended_date"),
                entry.get("recommended_hours"),
                entry.get("override_date"),
                entry.get("override_hours"),
                entry.get("comment"),
                entry.get("soil_moisture_source"),
            ),
        )
        return int(cursor.lastrowid)


def read_feedback(path: str | Path = DEFAULT_DB_PATH, limit: int = 200) -> list[dict[str, Any]]:
    db_path = initialize_feedback_table(path)
    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            "SELECT * FROM advisory_feedback ORDER BY id DESC LIMIT ?", (int(limit),)
        ).fetchall()
    return [dict(row) for row in rows]
