"""SignalDesk backend — Phase 1 skeleton.

Only a health endpoint for now. Every later phase adds routers here without
changing this file's shape: create the app once, attach routes, run via uvicorn.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db import init_db
from app.routes import (
    assets,
    briefings,
    fng,
    journal,
    macro,
    news,
    notes,
    signals,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Runs once when the server starts: create the DB file + schema and seed
    # the watchlist. `lifespan` is the modern replacement for the deprecated
    # @app.on_event("startup"). Code after `yield` would run on shutdown.
    init_db()
    yield


app = FastAPI(title="SignalDesk Local API", version="0.1.0", lifespan=lifespan)

# The browser running the Next.js app at :3000 will call this API at :8081.
# Browsers block cross-origin requests unless the server explicitly allows the
# caller's origin (the CORS rule). For a local single-user tool we allow only
# the local frontend origin — not "*", which is a habit worth keeping.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(assets.router)
app.include_router(signals.router)
app.include_router(briefings.router)
app.include_router(journal.router)
app.include_router(notes.router)
app.include_router(macro.router)
app.include_router(news.router)
app.include_router(fng.router)


@app.get("/health")
def health():
    """Liveness probe. Proves the service is up and the frontend can reach it
    through Docker's port mapping + CORS."""
    return {"status": "ok", "service": "signaldesk-backend", "phase": 10}
