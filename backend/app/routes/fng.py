"""/fng — crypto Fear & Greed Index (alternative.me, deterministic display).

No LLM, no derivation: we show their number verbatim and badge the source.
Tier-2 / risk-stance computations do NOT consume this — sentiment stays
walled off from the deterministic risk call (same boundary as news).
"""
from fastapi import APIRouter
from pydantic import BaseModel

from app.fng import get_snapshot

router = APIRouter(prefix="/fng", tags=["fng"])


class FngPoint(BaseModel):
    value: int                     # 0..100
    label: str                     # e.g. "Fear", "Greed"
    observed_at: str | None        # when alternative.me computed it


@router.get("", response_model=FngPoint | None)
def fng_snapshot():
    """Latest Fear & Greed index. Returns null if the upstream is
    unreachable on a cold cache — the UI then shows an empty state."""
    return get_snapshot()
