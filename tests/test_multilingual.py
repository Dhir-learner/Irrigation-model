from __future__ import annotations

import sys
from datetime import date

from src.agronomy import FarmConditions, fertigation_plan, irrigation_plan
from src.multilingual import LANGUAGES, advisory_facts, llm_advisory, template_advisory


def _facts():
    plan = irrigation_plan(
        FarmConditions(
            soil_moisture=0.14, temperature_c=23.3, latitude=12.44, area_ha=0.74,
            crop_age_days=180, start_date=date(2026, 9, 30),
        )
    )
    session = [{"date": "2026-09-30", "start": "05:00", "end": "08:00", "hours": 3}]
    return advisory_facts(plan, fertigation_plan(plan, 10.0, 0.74), session)


def test_templates_exist_for_all_languages_and_keep_numbers():
    facts = _facts()
    for code in LANGUAGES:
        text = template_advisory(facts, code)
        assert facts["hours"] in text
        assert facts["urea"] in text
        assert len(text.splitlines()) >= 4


def test_llm_path_falls_back_to_template_without_sdk(monkeypatch):
    monkeypatch.setitem(sys.modules, "anthropic", None)  # simulate a missing package
    facts = _facts()
    result = llm_advisory(facts, "kn")
    assert result["source"] == "template"
    assert result["text"] == template_advisory(facts, "kn")
