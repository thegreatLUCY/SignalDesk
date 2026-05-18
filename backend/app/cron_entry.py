"""The daily cron — its own container, one job: build the briefing at the
configured local time.

Why a Python scheduler (APScheduler) in a dedicated container, not host cron
or Docker's own thing: it's testable, it lives with the code, and it handles
the timezone correctly. We pin the IANA zone 'America/New_York' (NOT a fixed
UTC offset) so DST transitions are handled for us — "10:30 ET" stays 10:30 ET
in summer and winter.

Idempotency: briefing.generate() returns the existing row if today's already
done, so a restart at 10:31 — or this firing while you also hit the manual
endpoint — can't produce two briefings.
"""
import logging
import os
from datetime import datetime
from zoneinfo import ZoneInfo

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger

from app import briefing

logging.basicConfig(level=logging.INFO, format="%(asctime)s cron: %(message)s")
log = logging.getLogger("cron")

TZ = os.environ.get("CRON_TZ", "America/New_York")
HH, MM = (os.environ.get("CRON_TIME", "10:30").split(":") + ["0"])[:2]


def _run():
    log.info("firing daily briefing job")
    b = briefing.generate()  # idempotent
    prov = b["provenance"]
    log.info(
        "briefing for %s ready (provider=%s model=%s)",
        b["date"],
        prov.get("provider"),
        prov.get("model"),
    )


if __name__ == "__main__":
    tz = ZoneInfo(TZ)
    # Populate immediately if today's briefing is missing, so the dashboard
    # isn't empty until the next 10:30 — still idempotent (won't overwrite).
    log.info("startup: ensuring today's briefing exists (tz=%s)", TZ)
    try:
        _run()
    except Exception as e:  # never crash the scheduler on a bad first run
        log.warning("startup briefing failed (will retry on schedule): %s", e)

    sched = BlockingScheduler(timezone=tz)
    sched.add_job(_run, CronTrigger(hour=int(HH), minute=int(MM), timezone=tz))
    log.info(
        "scheduled daily briefing at %02d:%02d %s; now=%s",
        int(HH),
        int(MM),
        TZ,
        datetime.now(tz).isoformat(timespec="seconds"),
    )
    sched.start()
