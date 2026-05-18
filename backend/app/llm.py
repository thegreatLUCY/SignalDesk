"""The LLM provider chain — Tier 1's narrator, with graceful degradation.

ONE public function: `narrate(system, user)`. It tries providers in order:

    Groq  →  OpenRouter  →  (return None)

Returning None is not an error — it's the signal that the caller should use
its deterministic TEMPLATED fallback. That is the whole reason "the briefing
can never fail to exist": the last resort needs no network and no AI.

All providers here are OpenAI-COMPATIBLE, so they differ only by base URL,
API key, and model name — one request shape, config-swapped. Keys/models come
from .env (see .env.example). No key set for a provider → that provider is
skipped, not failed.
"""
from __future__ import annotations

import os

import requests

TIMEOUT = 40


def _provider_chain() -> list[dict]:
    chain = []
    if os.environ.get("GROQ_API_KEY"):
        chain.append(
            {
                "name": "groq",
                "url": "https://api.groq.com/openai/v1/chat/completions",
                "key": os.environ["GROQ_API_KEY"],
                "model": os.environ.get(
                    "GROQ_MODEL", "llama-3.3-70b-versatile"
                ),
            }
        )
    if os.environ.get("OPENROUTER_API_KEY"):
        chain.append(
            {
                "name": "openrouter",
                "url": "https://openrouter.ai/api/v1/chat/completions",
                "key": os.environ["OPENROUTER_API_KEY"],
                "model": os.environ.get(
                    "OPENROUTER_MODEL",
                    "meta-llama/llama-3.3-70b-instruct:free",
                ),
            }
        )
    return chain


def narrate(system: str, user: str) -> dict | None:
    """Return {text, provider, model} from the first provider that answers,
    or None if every provider is unavailable/failing (→ caller templates)."""
    for p in _provider_chain():
        try:
            r = requests.post(
                p["url"],
                headers={
                    "Authorization": f"Bearer {p['key']}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": p["model"],
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                    "temperature": 0.3,  # low: we want grounded, not creative
                },
                timeout=TIMEOUT,
            )
            r.raise_for_status()
            text = r.json()["choices"][0]["message"]["content"].strip()
            if text:
                return {
                    "text": text,
                    "provider": p["name"],
                    "model": p["model"],
                }
        except Exception:
            # Try the next provider; never raise — Tier 0 templating is the
            # floor and must always be reachable.
            continue
    return None
