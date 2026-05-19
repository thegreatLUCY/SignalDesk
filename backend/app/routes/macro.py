"""/macro — FRED macro snapshot (deterministic display data).

No LLM here on purpose: macro is just numbers. The briefing prompt is
separately handed these same numbers to NARRATE (see briefing.py), but the
risk stance never consumes them — that boundary is intentional.
"""
from fastapi import APIRouter

from app.macro import get_snapshot
from app.models import MacroPoint

router = APIRouter(prefix="/macro", tags=["macro"])


@router.get("", response_model=list[MacroPoint])
def macro_snapshot():
    """Latest value per tracked FRED series, read-through cached (6h TTL).
    `value` is None when FRED gave us nothing — the UI shows '—', we never
    invent a figure."""
    return get_snapshot()
