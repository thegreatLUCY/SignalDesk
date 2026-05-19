"""/journal — the trading journal (real / paper / observation).

A learning log, not a broker ledger. The user writes WHY (thesis) and later
the LESSON (outcome); P/L is computed in the db layer, never accepted from
the client — same "no garbage in" rule as the deterministic risk call.

PATCH teaching point: `model_dump(exclude_unset=True)` is what makes a true
partial update. Without it, every unsent field arrives as its default
(None) and would blank out columns the user never meant to touch. So we
forward ONLY the keys the client actually sent.
"""
from fastapi import APIRouter, HTTPException

from app.db import add_journal, delete_journal, list_journal, update_journal
from app.models import JournalEntry, JournalIn, JournalPatch

router = APIRouter(prefix="/journal", tags=["journal"])


@router.get("", response_model=list[JournalEntry])
def get_all():
    """All entries — open positions first, then newest. P/L derived."""
    return list_journal()


@router.post("", response_model=JournalEntry)
def create(entry: JournalIn):
    return add_journal(entry.model_dump())


@router.patch("/{entry_id}", response_model=JournalEntry)
def patch(entry_id: int, patch: JournalPatch):
    updated = update_journal(entry_id, patch.model_dump(exclude_unset=True))
    if updated is None:
        raise HTTPException(status_code=404, detail="No such entry")
    return updated


@router.delete("/{entry_id}")
def remove(entry_id: int):
    if not delete_journal(entry_id):
        raise HTTPException(status_code=404, detail="No such entry")
    return {"ok": True}
