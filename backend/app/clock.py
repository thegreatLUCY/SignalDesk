"""One definition of "today".

THE BUG THIS FIXES: "today" was computed as the UTC date in some places
(briefing._today, signal_service._today) while the cron *scheduled* in
America/New_York. Same word, two timezones — a split-brain where a civil
date could land on the wrong calendar day near midnight.

THE DISTINCTION worth remembering:
  • An *instant* (audit `created_at`) has no timezone debate — keep it UTC
    ISO. Those are NOT changed.
  • A *civil date* ("which trading day is it?") is inherently
    timezone-dependent. For a markets tool the only correct anchor is the
    market's clock — US Eastern — so we define it ONCE, here, and every
    "today" in the app comes through this function.
"""
import os
from datetime import datetime
from zoneinfo import ZoneInfo

# Same env var the cron uses, so scheduling and date-stamping can never drift
# apart again — they read the identical source of truth.
MARKET_TZ = os.environ.get("CRON_TZ", "America/New_York")


def market_today() -> str:
    """The current calendar date in the market's timezone, 'YYYY-MM-DD'."""
    return datetime.now(ZoneInfo(MARKET_TZ)).date().isoformat()
