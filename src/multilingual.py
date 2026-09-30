"""Farmer-friendly multilingual advisories: deterministic templates plus optional LLM.

The template path always works offline and never changes a number. The LLM path
(Claude) only rewrites the same facts into more natural language; it is used
when the ``anthropic`` package and credentials are available, and its output is
checked so every number in the facts still appears in the message.

Translations are prototype wording and need review by native speakers and the
KIAAR extension team before they reach farmers.
"""

from __future__ import annotations

import json
import re
from datetime import date
from typing import Any

from src.advisory import load_config

LANGUAGES = {"en": "English", "kn": "Kannada", "hi": "Hindi", "mr": "Marathi"}

TEMPLATES: dict[str, dict[str, str]] = {
    "en": {
        "IRRIGATE_NOW": "Irrigate today. Run the pump for {hours} hours (about {depth} mm of water).",
        "IRRIGATE_SOON": "Irrigate on {date} for {hours} hours (about {depth} mm of water).",
        "NOT_REQUIRED": "Irrigation is not required now. Next irrigation is expected around {date}.",
        "RAIN": "About {rain} mm of rain is expected, so irrigation is postponed by {days} days.",
        "STRESS": "Crop water stress: {stress}.",
        "PUMP": "Best pump time: {slot}.",
        "FERT": "Give fertilizer with irrigation on {date}: Urea {urea} kg and MOP {mop} kg per acre.",
        "DISCLAIMER": "This is an advisory only. Please confirm with your field officer.",
    },
    "kn": {
        "IRRIGATE_NOW": "ಇಂದು ನೀರು ಹಾಯಿಸಿ. ಪಂಪ್ ಅನ್ನು {hours} ಗಂಟೆಗಳ ಕಾಲ ಚಲಾಯಿಸಿ (ಸುಮಾರು {depth} ಮಿ.ಮೀ. ನೀರು).",
        "IRRIGATE_SOON": "{date} ರಂದು {hours} ಗಂಟೆಗಳ ಕಾಲ ನೀರು ಹಾಯಿಸಿ (ಸುಮಾರು {depth} ಮಿ.ಮೀ. ನೀರು).",
        "NOT_REQUIRED": "ಈಗ ನೀರಾವರಿ ಅಗತ್ಯವಿಲ್ಲ. ಮುಂದಿನ ನೀರಾವರಿ ಸುಮಾರು {date} ರಂದು.",
        "RAIN": "ಸುಮಾರು {rain} ಮಿ.ಮೀ. ಮಳೆ ನಿರೀಕ್ಷಿಸಲಾಗಿದೆ, ಆದ್ದರಿಂದ ನೀರಾವರಿಯನ್ನು {days} ದಿನ ಮುಂದೂಡಲಾಗಿದೆ.",
        "STRESS": "ಬೆಳೆಯ ನೀರಿನ ಒತ್ತಡ: {stress}.",
        "PUMP": "ಪಂಪ್ ಚಲಾಯಿಸಲು ಉತ್ತಮ ಸಮಯ: {slot}.",
        "FERT": "{date} ರಂದು ನೀರಿನೊಂದಿಗೆ ಗೊಬ್ಬರ ನೀಡಿ: ಪ್ರತಿ ಎಕರೆಗೆ ಯೂರಿಯಾ {urea} ಕೆ.ಜಿ. ಮತ್ತು ಎಂಒಪಿ {mop} ಕೆ.ಜಿ.",
        "DISCLAIMER": "ಇದು ಸಲಹೆ ಮಾತ್ರ. ದಯವಿಟ್ಟು ನಿಮ್ಮ ಕ್ಷೇತ್ರ ಅಧಿಕಾರಿಯೊಂದಿಗೆ ಖಚಿತಪಡಿಸಿಕೊಳ್ಳಿ.",
    },
    "hi": {
        "IRRIGATE_NOW": "आज सिंचाई करें। पंप को {hours} घंटे चलाएँ (लगभग {depth} मि.मी. पानी)।",
        "IRRIGATE_SOON": "{date} को {hours} घंटे सिंचाई करें (लगभग {depth} मि.मी. पानी)।",
        "NOT_REQUIRED": "अभी सिंचाई की आवश्यकता नहीं है। अगली सिंचाई लगभग {date} को होगी।",
        "RAIN": "लगभग {rain} मि.मी. वर्षा की संभावना है, इसलिए सिंचाई {days} दिन आगे बढ़ा दी गई है।",
        "STRESS": "फसल में जल तनाव: {stress}।",
        "PUMP": "पंप चलाने का सबसे अच्छा समय: {slot}।",
        "FERT": "{date} को सिंचाई के साथ खाद दें: प्रति एकड़ यूरिया {urea} कि.ग्रा. और एमओपी {mop} कि.ग्रा.।",
        "DISCLAIMER": "यह केवल एक सलाह है। कृपया अपने क्षेत्र अधिकारी से पुष्टि करें।",
    },
    "mr": {
        "IRRIGATE_NOW": "आज पाणी द्या. पंप {hours} तास चालवा (सुमारे {depth} मि.मी. पाणी).",
        "IRRIGATE_SOON": "{date} रोजी {hours} तास पाणी द्या (सुमारे {depth} मि.मी. पाणी).",
        "NOT_REQUIRED": "सध्या पाणी देण्याची गरज नाही. पुढील पाणी सुमारे {date} रोजी द्यावे.",
        "RAIN": "सुमारे {rain} मि.मी. पावसाची शक्यता आहे, म्हणून पाणी देणे {days} दिवस पुढे ढकलले आहे.",
        "STRESS": "पिकावरील पाण्याचा ताण: {stress}.",
        "PUMP": "पंप चालवण्याची सर्वोत्तम वेळ: {slot}.",
        "FERT": "{date} रोजी पाण्यासोबत खत द्या: प्रति एकर युरिया {urea} किलो आणि एमओपी {mop} किलो.",
        "DISCLAIMER": "हा फक्त सल्ला आहे. कृपया आपल्या क्षेत्र अधिकाऱ्याकडून खात्री करा.",
    },
}

STRESS_WORDS = {
    "en": {"NONE": "none", "MILD": "mild", "MODERATE": "moderate", "SEVERE": "severe"},
    "kn": {"NONE": "ಇಲ್ಲ", "MILD": "ಸ್ವಲ್ಪ", "MODERATE": "ಮಧ್ಯಮ", "SEVERE": "ತೀವ್ರ"},
    "hi": {"NONE": "नहीं", "MILD": "हल्का", "MODERATE": "मध्यम", "SEVERE": "गंभीर"},
    "mr": {"NONE": "नाही", "MILD": "सौम्य", "MODERATE": "मध्यम", "SEVERE": "तीव्र"},
}


def _format_date(iso: str) -> str:
    return date.fromisoformat(iso).strftime("%d-%m-%Y")


def advisory_facts(
    plan: dict[str, Any],
    fertigation: dict[str, Any] | None = None,
    pump_sessions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Reduce the full engine output to the facts a farmer message may use."""
    recommendation = plan["recommendation"]
    rain = plan["rainfall_adjustment"]
    facts: dict[str, Any] = {
        "status": recommendation["status"],
        "date": _format_date(recommendation["next_irrigation_date"]),
        "hours": f"{recommendation['duration_hours']:.1f}",
        "depth": f"{recommendation['gross_depth_mm']:.0f}",
        "stress": plan["water_stress"]["category"],
        "rain": f"{rain['forecast_rain_mm']:.0f}",
        "postponed_days": int(rain["postponed_days"]),
    }
    if pump_sessions:
        first = pump_sessions[0]
        facts["slot"] = f"{_format_date(first['date'])} {first['start']}-{first['end']}"
    if fertigation:
        per_acre = fertigation["products_per_application_kg_acre"]
        facts["fert_date"] = _format_date(fertigation["next_fertigation_date"])
        facts["urea"] = f"{per_acre['Urea']:.1f}"
        facts["mop"] = f"{per_acre['MOP']:.1f}"
    return facts


def template_advisory(facts: dict[str, Any], language: str = "en") -> str:
    """Deterministic advisory text in one of the supported languages."""
    lang = language if language in TEMPLATES else "en"
    text = TEMPLATES[lang]
    lines = [text[facts["status"]].format(**facts)]
    if facts.get("postponed_days", 0) > 0:
        lines.append(text["RAIN"].format(rain=facts["rain"], days=facts["postponed_days"]))
    lines.append(text["STRESS"].format(stress=STRESS_WORDS[lang][facts["stress"]]))
    if facts.get("slot") and facts["status"] != "NOT_REQUIRED":
        lines.append(text["PUMP"].format(slot=facts["slot"]))
    if facts.get("urea") is not None:
        lines.append(text["FERT"].format(date=facts["fert_date"], urea=facts["urea"], mop=facts["mop"]))
    lines.append(text["DISCLAIMER"])
    return "\n".join(lines)


SYSTEM_PROMPT = (
    "You write short irrigation advisories for sugarcane farmers in Karnataka. "
    "You receive verified facts as JSON. Write 3 to 5 short, plain sentences in the requested "
    "language that a farmer can act on. Use every number exactly as given, in Western digits. "
    "Do not add any recommendation, number, product or date that is not in the facts. "
    "End by asking the farmer to confirm with their field officer. Output only the message."
)


def _numbers(text: str) -> set[str]:
    return set(re.findall(r"\d+(?:\.\d+)?", text))


def llm_advisory(facts: dict[str, Any], language: str = "en", config: dict[str, Any] | None = None) -> dict[str, Any]:
    """Rewrite the facts with Claude. Falls back to the template on any failure.

    Returns ``{"text", "source", "note"}`` where source is ``llm`` or ``template``.
    """
    fallback = template_advisory(facts, language)
    try:
        import anthropic  # type: ignore
    except ImportError:
        return {"text": fallback, "source": "template", "note": "anthropic package not installed"}

    settings = (config or load_config()).get("advisory_llm", {})
    model = settings.get("model", "claude-opus-5-5")
    try:
        client = anthropic.Anthropic()
        response = client.beta.messages.create(
            model=model,
            max_tokens=2000,
            system=SYSTEM_PROMPT,
            output_config={"effort": settings.get("effort", "low")},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            messages=[
                {
                    "role": "user",
                    "content": f"Language: {LANGUAGES.get(language, 'English')}\nFacts:\n{json.dumps(facts, ensure_ascii=False)}",
                }
            ],
        )
    except anthropic.APIConnectionError:
        return {"text": fallback, "source": "template", "note": "Claude API unreachable"}
    except anthropic.AuthenticationError:
        return {"text": fallback, "source": "template", "note": "no valid Anthropic credentials"}
    except anthropic.APIStatusError as error:
        return {"text": fallback, "source": "template", "note": f"Claude API error {error.status_code}"}
    except Exception as error:  # credentials missing raises a plain TypeError in some SDK versions
        return {"text": fallback, "source": "template", "note": f"LLM unavailable: {type(error).__name__}"}

    if response.stop_reason == "refusal":
        return {"text": fallback, "source": "template", "note": "LLM declined; template used"}
    text = "".join(block.text for block in response.content if block.type == "text").strip()
    keys = ["urea", "mop"] + (["hours", "depth"] if facts["status"] != "NOT_REQUIRED" else [])
    required = _numbers(" ".join(str(facts.get(key, "")) for key in keys))
    missing = required - _numbers(text)
    if not text or missing:
        return {
            "text": fallback,
            "source": "template",
            "note": f"LLM output dropped or altered numbers {sorted(missing)}; template used",
        }
    return {"text": text, "source": "llm", "note": f"Generated by {model}; numbers verified against facts"}
