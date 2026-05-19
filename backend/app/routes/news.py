"""/news — free RSS headlines + an on-demand, descriptive LLM brief.

Two deliberate constraints:
  • The brief is POST-triggered and cached per market-day, so the Groq call
    is only ever spent on an explicit user action (same philosophy as the
    briefing's ↻ regenerate) — never silently on tab open.
  • Nothing here feeds signals or the risk stance. News is context to read,
    not an input to the computed conclusion.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter

from app import news
from app.clock import market_today
from app.db import get_news, latest_news_fetch
from app.models import NewsBrief, NewsItem

router = APIRouter(prefix="/news", tags=["news"])

# Headlines refresh at most every 30 min (RSS updates hourly-ish).
_NEWS_TTL = timedelta(minutes=30)

# In-memory, per-day cache of the descriptive brief. Not persisted: it's a
# convenience derivative of headlines, cheap to regenerate, and bounding it
# to one market day is enough to stop accidental quota burn.
_brief_cache: dict[str, dict] = {}


def _stale() -> bool:
    last = latest_news_fetch()
    if not last:
        return True
    return datetime.now(timezone.utc) - datetime.fromisoformat(last) > _NEWS_TTL


@router.get("", response_model=list[NewsItem])
def list_news():
    """Recent headlines, read-through cached. Pulls feeds only if our last
    pull is older than the TTL."""
    if _stale():
        news.refresh()
    return get_news(limit=40)


@router.get("/brief", response_model=NewsBrief | None)
def get_brief():
    """Today's cached brief if one was generated, else null (the UI then
    shows a 'summarise' button rather than auto-spending a call)."""
    return _brief_cache.get(market_today())


@router.post("/brief", response_model=NewsBrief)
def make_brief():
    """Generate (and cache for today) a descriptive summary of the current
    headlines. Explicit user action — this is where the Groq call is spent."""
    if _stale():
        news.refresh()
    res = news.brief()
    res["generated_at"] = datetime.now(timezone.utc).isoformat()
    _brief_cache[market_today()] = res
    return res
