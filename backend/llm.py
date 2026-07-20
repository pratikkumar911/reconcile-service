"""LLM explanations for discrepancies (OpenAI gpt-4.1-mini via Emergent Universal Key)."""
import os
import json
import asyncio
import logging
from typing import Dict, Any

from emergentintegrations.llm.chat import LlmChat, UserMessage

logger = logging.getLogger(__name__)

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
MODEL_PROVIDER = "openai"
MODEL_NAME = "gpt-4.1-mini"
TIMEOUT_S = 15


SYSTEM_PROMPT = (
    "You are a finance-operations assistant helping a store owner understand "
    "reconciliation discrepancies between their orders and payment processor. "
    "Reply ONLY in JSON with keys: summary (1 sentence, plain English), "
    "likely_cause (1-2 sentences), suggested_action (1 short imperative sentence). "
    "Keep it concrete, avoid jargon, do not invent numbers."
)


def _fallback(reason: str) -> Dict[str, Any]:
    return {
        "summary": "Explanation could not be generated.",
        "likely_cause": f"LLM service issue: {reason}",
        "suggested_action": "Please try again in a moment.",
    }


def _build_user_prompt(discrepancy: Dict[str, Any]) -> str:
    payload = {
        "type": discrepancy.get("type"),
        "order_id": discrepancy.get("order_id"),
        "payment_id": discrepancy.get("payment_id"),
        "expected_amount": discrepancy.get("expected_amount"),
        "actual_amount": discrepancy.get("actual_amount"),
        "currency": discrepancy.get("currency"),
        "money_at_risk": discrepancy.get("money_at_risk"),
        "details": discrepancy.get("details_json") or {},
    }
    return (
        "Explain this reconciliation discrepancy for a non-technical store owner. "
        "Return strictly JSON with the required keys.\n\n"
        f"Discrepancy:\n{json.dumps(payload, default=str)}"
    )


async def _call_once(discrepancy: Dict[str, Any]) -> Dict[str, Any]:
    if not EMERGENT_LLM_KEY:
        return _fallback("EMERGENT_LLM_KEY not configured")

    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"discrepancy-{discrepancy.get('id','unknown')}",
        system_message=SYSTEM_PROMPT,
    ).with_model(MODEL_PROVIDER, MODEL_NAME).with_params(temperature=0.2)

    user_msg = UserMessage(text=_build_user_prompt(discrepancy))
    text = await asyncio.wait_for(chat.send_message(user_msg), timeout=TIMEOUT_S)

    # Try to extract JSON from response
    if isinstance(text, dict):
        text_str = json.dumps(text)
    else:
        text_str = str(text)

    # Strip code fences if present
    stripped = text_str.strip()
    if stripped.startswith("```"):
        stripped = stripped.strip("`")
        if stripped.lower().startswith("json"):
            stripped = stripped[4:].strip()

    # Find first `{` and last `}`
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start >= 0 and end > start:
        candidate = stripped[start : end + 1]
        parsed = json.loads(candidate)
        if all(k in parsed for k in ("summary", "likely_cause", "suggested_action")):
            return {
                "summary": str(parsed["summary"])[:400],
                "likely_cause": str(parsed["likely_cause"])[:600],
                "suggested_action": str(parsed["suggested_action"])[:400],
            }
    raise ValueError("Malformed LLM JSON response")


async def explain_discrepancy(discrepancy: Dict[str, Any]) -> Dict[str, Any]:
    """Two-attempt LLM call with graceful fallback."""
    for attempt in (1, 2):
        try:
            return await _call_once(discrepancy)
        except asyncio.TimeoutError:
            logger.warning("LLM timed out on attempt %s", attempt)
            last_err = "LLM timed out"
        except Exception as e:  # noqa: BLE001
            logger.warning("LLM error on attempt %s: %s", attempt, e)
            last_err = str(e)
    return _fallback(last_err)
