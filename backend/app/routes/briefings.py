"""/briefings — list, read (with Tier-2 annotations), annotate, regenerate.

The detail endpoint returns the Tier-1 draft AND its Tier-2 annotations
together. The draft is never mutated; annotations are separate append-only
rows — so this endpoint shows the full audit trail, not a flattened result.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app import briefing
from app.db import (
    add_annotation,
    get_annotations,
    get_briefing,
    get_latest_briefing,
    list_briefings,
)
from app.models import Briefing, BriefingDetail, BriefingListItem

router = APIRouter(prefix="/briefings", tags=["briefings"])


def _detail(b: dict) -> dict:
    return {**b, "annotations": get_annotations(b["id"])}


@router.get("", response_model=list[BriefingListItem])
def list_all():
    """All briefing dates, newest first — powers the archive date browser."""
    return list_briefings()


@router.get("/latest", response_model=BriefingDetail | None)
def latest():
    b = get_latest_briefing()
    return _detail(b) if b else None


@router.get("/{date}", response_model=BriefingDetail)
def by_date(date: str):
    b = get_briefing(date)
    if not b:
        raise HTTPException(status_code=404, detail=f"No briefing for {date}")
    return _detail(b)


class AnnotationIn(BaseModel):
    body: str
    provider: str = "manual"  # MCP/Tier-2 (Phase 8) will pass 'claude' etc.
    model: str = "manual"


@router.post("/{date}/annotations", response_model=BriefingDetail)
def annotate(date: str, ann: AnnotationIn):
    """Layer a Tier-2 note onto a briefing. Foundation for the Phase 8 MCP
    write path; also usable manually now."""
    b = get_briefing(date)
    if not b:
        raise HTTPException(status_code=404, detail=f"No briefing for {date}")
    add_annotation(
        b["id"],
        ann.body,
        {
            "tier": 2,
            "provider": ann.provider,
            "model": ann.model,
            "created_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    return _detail(get_briefing(date))


@router.post("/run", response_model=Briefing)
def run(force: bool = False):
    """Generate today's briefing now. force=true regenerates even if it
    exists (handy right after adding an API key)."""
    return briefing.generate(force=force)
