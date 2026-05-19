"""/notes — Notion-like free-form markdown notes.

Contrast with /briefings annotations and /assets analysis: those are an
append-only AUDIT trail (who-said-what, never mutated). A note is a personal
document the user OWNS, so editing in place is the correct semantics. Same
storage engine, deliberately opposite mutation rule — that distinction is
the design judgement, not an accident.
"""
from fastapi import APIRouter, HTTPException

from app.db import add_note, delete_note, get_note, list_notes, update_note
from app.models import Note, NoteIn, NotePatch

router = APIRouter(prefix="/notes", tags=["notes"])


@router.get("", response_model=list[Note])
def get_all():
    """Pinned first, then most-recently edited."""
    return list_notes()


@router.get("/{note_id}", response_model=Note)
def get_one(note_id: int):
    n = get_note(note_id)
    if n is None:
        raise HTTPException(status_code=404, detail="No such note")
    return n


@router.post("", response_model=Note)
def create(note: NoteIn):
    return add_note(note.title, note.body, note.symbol)


@router.patch("/{note_id}", response_model=Note)
def patch(note_id: int, patch: NotePatch):
    updated = update_note(note_id, patch.model_dump(exclude_unset=True))
    if updated is None:
        raise HTTPException(status_code=404, detail="No such note")
    return updated


@router.delete("/{note_id}")
def remove(note_id: int):
    if not delete_note(note_id):
        raise HTTPException(status_code=404, detail="No such note")
    return {"ok": True}
