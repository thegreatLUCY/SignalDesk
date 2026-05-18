# SignalDesk MCP server (Tier-2 bridge)

One stdio MCP server, used by **both Claude and Codex**. The server is
identical for every client — only each client's own config differs. It talks
to the running backend over HTTP (`localhost:8081`), so the one-writer rule
holds (FastAPI is still the only thing touching SQLite).

Prerequisite: the stack is running (`docker compose up`) so the backend is
reachable at `http://localhost:8081`.

## One-time setup (host Python venv)

The MCP client launches this as a local subprocess, so it needs a tiny Python
env on your Mac (not in Docker):

```bash
cd /Users/robeirtoma/signaldesk/mcp
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

The launch command is then:
`/Users/robeirtoma/signaldesk/mcp/.venv/bin/python /Users/robeirtoma/signaldesk/mcp/server.py`

Two env vars:
- `BACKEND_URL` (default `http://localhost:8081`)
- `MCP_AGENT` — set per client so provenance is honest: `claude` or `codex`.

## Connect Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "signaldesk": {
      "command": "/Users/robeirtoma/signaldesk/mcp/.venv/bin/python",
      "args": ["/Users/robeirtoma/signaldesk/mcp/server.py"],
      "env": { "MCP_AGENT": "claude", "BACKEND_URL": "http://localhost:8081" }
    }
  }
}
```
Restart Claude Desktop. In a chat: "use signaldesk to deep-dive NVDA".

## Connect Claude Code

```bash
claude mcp add signaldesk \
  --env MCP_AGENT=claude --env BACKEND_URL=http://localhost:8081 \
  -- /Users/robeirtoma/signaldesk/mcp/.venv/bin/python \
     /Users/robeirtoma/signaldesk/mcp/server.py
```

## Connect Codex CLI

Edit `~/.codex/config.toml`:

```toml
[mcp_servers.signaldesk]
command = "/Users/robeirtoma/signaldesk/mcp/.venv/bin/python"
args = ["/Users/robeirtoma/signaldesk/mcp/server.py"]
env = { MCP_AGENT = "codex", BACKEND_URL = "http://localhost:8081" }
```

Same server. The only difference between Claude and Codex is `MCP_AGENT`,
which makes notes badge `tier 2 · claude` vs `tier 2 · codex` in the UI.

## Tools exposed

Read: `list_assets`, `get_signals(symbol)`, `get_briefing(date?)`,
`get_asset_analysis(symbol)`.
Write: `write_annotation(body,date?)`, `write_asset_analysis(symbol,body)`.

Writes go through the backend and appear in the dashboard's briefing bar /
asset notes, attributed to the agent — the Tier-1 draft is never modified.
