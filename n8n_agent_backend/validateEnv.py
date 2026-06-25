"""
MCP-side environment variable validation.

Mirrors `backend/middleware/validateEnv.js` so a malformed `.env` fails
fast with a readable error instead of letting uvicorn boot a broken
service. In production every documented secret is required; in
development we accept the testnet defaults.

Behavior:
    - validate_env() raises EnvironmentError on the first missing required
      var. The MCP server boots fail-fast so docker / render / fly mark
      the deploy as failed.
    - In development mode (NODE_ENV != 'production'), missing optional vars
      get sensible defaults so contributors can run the smoke test
      without configuring Supabase / Redis.
"""

from __future__ import annotations

import os
import re
import sys
from typing import Any, Dict, List, Tuple


# (name, default, required_in_prod, validator)
_DEFS: List[Tuple[str, Any, bool, Any]] = [
    ("CASPEROPS_BACKEND_URL", "http://localhost:3000", False, str),
    ("CASPER_RPC_URL", "https://rpc.testnet.casper.live/rpc", False, str),
    ("CASPER_RPC_URL_FALLBACK", "", False, str),  # Phase 30: optional secondary RPC
    ("CSPR_CLOUD_API_URL", "https://api.testnet.cspr.cloud", False, str),
    ("CSPR_CLOUD_API_KEY", "", False, str),
    ("CASPER_FAUCET_URL", "https://testnet.cspr.live/tools/faucet", False, str),
    ("CASPER_EXPLORER_BASE_URL", "https://testnet.cspr.live", False, str),
    ("REDIS_URL", "", False, str),
    ("POSTGRES_DSN", "", False, str),
    # At least one AI key required in production
    ("GROQ_API_KEY1", "", True, str),
    ("GROQ_API_KEY2", "", False, str),
    ("GROQ_API_KEY3", "", False, str),
    ("GEMINI_API_KEY", "", False, str),
    # Contract hashes — required in production for get_reputation + read tools
    ("CASPER_REPUTATION_HASH", "", True, str),
    ("CASPER_AGENT_FACTORY_HASH", "", False, str),
    ("CASPER_ESCROW_HASH", "", False, str),
    ("CASPER_COMPLIANCE_HASH", "", False, str),
]


_HEX_64 = re.compile(r"^(0x)?[0-9a-fA-F]{64}$")


def _is_production() -> bool:
    return os.getenv("NODE_ENV", "development") == "production"


def _has_ai_key() -> bool:
    return any(
        os.getenv(k)
        for k in ("GROQ_API_KEY1", "GROQ_API_KEY2", "GROQ_API_KEY3", "GEMINI_API_KEY")
    )


def validate_env(strict: bool | None = None) -> Dict[str, Any]:
    """Validate required env vars. Returns a dict of parsed values.

    Args:
        strict: if True, enforce production rules even when NODE_ENV is
                not 'production'. Useful for CI.

    Raises:
        EnvironmentError: when a required var is missing or malformed.
    """
    is_prod = strict if strict is not None else _is_production()

    parsed: Dict[str, Any] = {}
    missing: List[str] = []
    bad: List[str] = []

    for name, default, required_in_prod, _typ in _DEFS:
        raw = (os.getenv(name) or "").strip()
        if not raw:
            if required_in_prod and is_prod:
                missing.append(name)
                continue
            parsed[name] = default
            continue
        if name in {"CASPER_SECRET_KEY", "CASPER_AGENT_FACTORY_HASH",
                    "CASPER_REPUTATION_HASH", "CASPER_ESCROW_HASH",
                    "CASPER_COMPLIANCE_HASH"} and not _HEX_64.match(raw):
            bad.append(f"{name} (must be 64-char hex)")
            continue
        parsed[name] = raw

    if is_prod and not _has_ai_key():
        missing.append("at least one of GROQ_API_KEY1/GROQ_API_KEY2/GROQ_API_KEY3/GEMINI_API_KEY")

    if missing or bad:
        banner = "=" * 72
        lines = [f"\n{banner}\n  CasperOPs MCP boot aborted — invalid environment\n{banner}"]
        if missing:
            lines.append("\nMissing required variables:")
            for n in missing:
                lines.append(f"  - {n}")
        if bad:
            lines.append("\nInvalid values:")
            for n in bad:
                lines.append(f"  - {n}")
        lines.append(
            "\nFix the variables above in your .env / hosting secret store, "
            "then retry.\n" + banner + "\n"
        )
        raise EnvironmentError("\n".join(lines))

    return parsed


if __name__ == "__main__":
    try:
        validate_env()
        print("[validateEnv] ok")
    except EnvironmentError as err:
        print(err, file=sys.stderr)
        sys.exit(1)