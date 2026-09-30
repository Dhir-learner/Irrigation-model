from __future__ import annotations

from datetime import date, timedelta

from src.scheduling import schedule_feeder, schedule_pump

START = date(2026, 10, 1)


def test_single_pump_prefers_morning_and_covers_hours():
    sessions = schedule_pump(7.5, START)
    assert sessions[0]["start"] == "05:00"
    assert sum(session["hours"] for session in sessions) == 7.5
    assert all(session["date"] >= START.isoformat() for session in sessions)


def test_feeder_respects_capacity_and_due_dates():
    farms = [
        {"farm_id": f"F{i}", "hours": 3.0, "due_day": 0 if i < 3 else 2, "stress_index": 0.1 * i}
        for i in range(5)
    ]
    result = schedule_feeder(farms, START, days=5, max_concurrent=2)
    assert result["peak_concurrent_pumps"] <= 2
    assert not result["unscheduled"]
    by_farm: dict[str, list[dict]] = {}
    for row in result["assignments"]:
        by_farm.setdefault(row["farm_id"], []).append(row)
    for farm in farms:
        rows = by_farm[farm["farm_id"]]
        assert sum(row["hours"] for row in rows) == farm["hours"]
        earliest = (START + timedelta(days=farm["due_day"])).isoformat()
        assert min(row["date"] for row in rows) >= earliest


def test_feeder_reports_farms_that_do_not_fit():
    result = schedule_feeder([{"farm_id": "BIG", "hours": 100.0, "due_day": 0}], START, days=1, max_concurrent=1)
    shortfall = result["unscheduled"][0]
    assert shortfall["farm_id"] == "BIG"
    assert shortfall["hours_scheduled"] == 9.0  # three 3-hour supply windows in one day
    assert shortfall["hours_unmet"] == 91.0
    assert result["unmet_hours"] == 91.0
