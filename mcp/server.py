"""SignalDesk MCP server — the Tier-2 bridge.

ONE server, client-agnostic. MCP is an open JSON-RPC-over-stdio protocol, so
Claude Desktop, Claude Code, and Codex CLI all launch this exact file the
same way — only their own config differs (see mcp/README.md).

Design (matches the architecture brainstorm):
  • TOOLS ONLY — the universal subset every MCP client supports. No
    resources/prompts (support varies across clients).
  • Talks to the BACKEND over HTTP (localhost:8081), never the DB directly.
    The §0 one-writer rule holds: FastAPI stays the only DB opener; MCP is
    just another HTTP client, like the dashboard.
  • PROVENANCE per client: env MCP_AGENT ('claude' | 'codex' | ...) is
    stamped on every write, so a Claude note badges `tier 2 · claude` and a
    Codex one `tier 2 · codex`. Same server, honest attribution.

Nothing here is Claude- or Codex-specific.
"""
import json
import os
import urllib.error
import urllib.request

from mcp.server.fastmcp import FastMCP

BACKEND = os.environ.get("BACKEND_URL", "http://localhost:8081").rstrip("/")
AGENT = os.environ.get("MCP_AGENT", "claude")  # set per client in its config

mcp = FastMCP("signaldesk")


def _get(path: str):
    with urllib.request.urlopen(f"{BACKEND}{path}", timeout=30) as r:
        return json.loads(r.read())


def _post(path: str, payload: dict):
    req = urllib.request.Request(
        f"{BACKEND}{path}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


# ── READ tools (give the strong model real local context) ────────────────
@mcp.tool()
def list_assets() -> list:
    """List the watchlist assets (symbol, class, aliases)."""
    return _get("/assets")


@mcp.tool()
def get_signals(symbol: str) -> dict:
    """Tier-0 deterministic signal summary for one asset (trend, %, RSI,
    ATR, 52w distance, flags-relevant fields). Chart overlay series are
    stripped to keep the response compact."""
    d = _get(f"/assets/{symbol}/signals")
    d.pop("lines", None)  # huge MA arrays — not useful as model context
    return d


@mcp.tool()
def get_briefing(date: str = "") -> dict:
    """The Tier-1 daily briefing (latest if no date) WITH its Tier-2
    annotations. Read this before annotating so you build on it."""
    return _get(f"/briefings/{date}" if date else "/briefings/latest")


@mcp.tool()
def get_asset_analysis(symbol: str) -> list:
    """Prior notes for an asset (Tier-1 auto + any Tier-2 deep-dives), so
    you can extend/correct rather than repeat."""
    return _get(f"/assets/{symbol}/analysis")


# ── WRITE tools (the Tier-2 path; stamped with this client's identity) ────
@mcp.tool()
def write_annotation(body: str, date: str = "") -> dict:
    """Layer a Tier-2 annotation onto a briefing (today's if no date). The
    original draft is NOT modified — your note is appended and attributed to
    this agent. Use to correct/extend the auto-draft."""
    if not date:
        latest = _get("/briefings/latest")
        if not latest:
            return {"error": "no briefing exists yet to annotate"}
        date = latest["date"]
    return _post(
        f"/briefings/{date}/annotations",
        {"body": body, "provider": AGENT, "model": AGENT},
    )


@mcp.tool()
def write_asset_analysis(symbol: str, body: str) -> dict:
    """Write a Tier-2 deep-dive note for an asset. Append-only — coexists
    with the Tier-1 auto-note; attributed to this agent."""
    return _post(
        f"/assets/{symbol}/analysis",
        {"body": body, "provider": AGENT, "model": AGENT},
    )


if __name__ == "__main__":
    mcp.run()  # stdio transport (the default) — what every MCP client expects
