"""Pump scheduling against electricity supply windows.

Two levels:
    * ``schedule_pump`` places one farm's pumping hours into the next available
      supply windows, preferring the morning window (lower evaporation loss).
    * ``schedule_feeder`` allocates many farms that share one feeder, where only
      ``max_concurrent_pumps`` can run at once. It is a greedy earliest-deadline-
      first heuristic in 30-minute slots, not a proven optimum.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Any

from src.advisory import load_config

SLOT_MINUTES = 30


@dataclass(frozen=True)
class Window:
    start: time
    end: time

    @property
    def hours(self) -> float:
        start = datetime.combine(date.min, self.start)
        end = datetime.combine(date.min, self.end)
        return (end - start).total_seconds() / 3600


def supply_windows(config: dict[str, Any] | None = None) -> list[Window]:
    cfg = (config or load_config())["pump_scheduling"]
    windows = [
        Window(time.fromisoformat(item["start"]), time.fromisoformat(item["end"]))
        for item in cfg["supply_windows"]
    ]
    return sorted(windows, key=lambda window: window.start)


def _ordered(windows: list[Window], prefer_morning: bool) -> list[Window]:
    if not prefer_morning:
        return windows
    morning = [window for window in windows if window.start < time(12, 0)]
    rest = [window for window in windows if window.start >= time(12, 0)]
    return morning + rest


def schedule_pump(
    hours_needed: float,
    start_date: date,
    config: dict[str, Any] | None = None,
    max_days: int = 14,
) -> list[dict[str, Any]]:
    """Split a farm's pumping requirement over consecutive supply windows."""
    full_config = config or load_config()
    cfg = full_config["pump_scheduling"]
    windows = _ordered(supply_windows(full_config), bool(cfg.get("prefer_morning", True)))
    remaining = max(0.0, float(hours_needed))
    sessions: list[dict[str, Any]] = []
    for offset in range(max_days):
        day = start_date + timedelta(days=offset)
        for window in windows:
            if remaining <= 1e-9:
                return sessions
            run = min(remaining, window.hours)
            begin = datetime.combine(day, window.start)
            finish = begin + timedelta(hours=run)
            sessions.append(
                {
                    "date": day.isoformat(),
                    "start": begin.strftime("%H:%M"),
                    "end": finish.strftime("%H:%M"),
                    "hours": round(run, 2),
                }
            )
            remaining -= run
    return sessions


def schedule_feeder(
    farms: list[dict[str, Any]],
    start_date: date,
    config: dict[str, Any] | None = None,
    days: int = 7,
    max_concurrent: int | None = None,
) -> dict[str, Any]:
    """Allocate pumping slots for farms sharing one electricity feeder.

    Each farm dict needs ``farm_id``, ``hours`` and ``due_day`` (days from
    ``start_date`` when irrigation becomes due); ``stress_index`` breaks ties.
    Farms due soonest are served first; within a farm, slots are filled in
    window order (morning first when configured). A farm that cannot get all
    its hours keeps the slots it did get and is listed with its unmet hours.
    """
    full_config = config or load_config()
    cfg = full_config["pump_scheduling"]
    capacity = int(max_concurrent or cfg["max_concurrent_pumps_per_feeder"])
    windows = _ordered(supply_windows(full_config), bool(cfg.get("prefer_morning", True)))

    slots: list[datetime] = []
    for offset in range(days):
        day = start_date + timedelta(days=offset)
        for window in windows:
            cursor = datetime.combine(day, window.start)
            end = datetime.combine(day, window.end)
            while cursor + timedelta(minutes=SLOT_MINUTES) <= end:
                slots.append(cursor)
                cursor += timedelta(minutes=SLOT_MINUTES)
    usage = {slot: 0 for slot in slots}

    queue = sorted(
        farms,
        key=lambda farm: (int(farm.get("due_day", 0)), -float(farm.get("stress_index", 0.0)), str(farm["farm_id"])),
    )
    assignments: list[dict[str, Any]] = []
    unscheduled: list[dict[str, Any]] = []
    for farm in queue:
        due = start_date + timedelta(days=max(0, int(farm.get("due_day", 0))))
        needed_slots = max(1, round(float(farm["hours"]) * 60 / SLOT_MINUTES))
        taken: list[datetime] = []
        for slot in slots:
            if slot.date() < due:
                continue
            if usage[slot] < capacity:
                taken.append(slot)
                if len(taken) == needed_slots:
                    break
        if len(taken) < needed_slots:
            scheduled_hours = len(taken) * SLOT_MINUTES / 60
            unscheduled.append(
                {
                    "farm_id": farm["farm_id"],
                    "hours": float(farm["hours"]),
                    "hours_scheduled": scheduled_hours,
                    "hours_unmet": round(float(farm["hours"]) - scheduled_hours, 2),
                    "reason": "feeder capacity or horizon exhausted",
                }
            )
        for slot in taken:
            usage[slot] += 1
        for block in _merge(taken):
            assignments.append({"farm_id": farm["farm_id"], **block})

    peak = max(usage.values()) if usage else 0
    utilisation = sum(usage.values()) / (len(slots) * capacity) if slots and capacity else 0.0
    demand = sum(float(farm["hours"]) for farm in farms)
    unmet = sum(item["hours_unmet"] for item in unscheduled)
    return {
        "demand_hours": round(demand, 2),
        "unmet_hours": round(unmet, 2),
        "method_note": "Greedy earliest-due-first allocation in 30-minute slots; a heuristic, not a proven optimum.",
        "capacity_per_slot": capacity,
        "assignments": assignments,
        "unscheduled": unscheduled,
        "peak_concurrent_pumps": peak,
        "feeder_utilisation": round(utilisation, 3),
    }


def _merge(taken: list[datetime]) -> list[dict[str, Any]]:
    """Merge adjacent 30-minute slots into continuous pumping sessions."""
    blocks: list[dict[str, Any]] = []
    step = timedelta(minutes=SLOT_MINUTES)
    for slot in sorted(taken):
        if blocks and blocks[-1]["_end"] == slot:
            blocks[-1]["_end"] = slot + step
        else:
            blocks.append({"_start": slot, "_end": slot + step})
    return [
        {
            "date": block["_start"].date().isoformat(),
            "start": block["_start"].strftime("%H:%M"),
            "end": block["_end"].strftime("%H:%M"),
            "hours": round((block["_end"] - block["_start"]).total_seconds() / 3600, 2),
        }
        for block in blocks
    ]
