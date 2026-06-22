"""
BlockOps MCP unified dispatcher.

Single source of truth for the 19 backend tools exposed via the BlockOps
MCP server. Both transports (stdio `mcp_server.py`, HTTP/SSE
`mcp_server_sse.py`) call into this module.

How it works:
    1. The catalog is loaded from `tools/schema.json` at import time.
    2. Each tool is classified into one of three handler types:
         - "proxy"  → forward to the BlockOps backend `/v1/tools/:toolId`
                      endpoint (built in Phase 20). The proxy surfaces
                      x402 challenges back to the agent so it can sign a
                      payment deploy via CSPR.click and retry.
         - "local"  → compute in-process (no network round-trip).
                      Currently: calculate.
         - "rpc"    → query the Casper RPC or CSPR.cloud directly.
                      Best-effort read-only tools.
    3. `dispatch(payload)` returns a JSON-serialisable dict so it can be
       transported over stdio JSON-RPC, SSE, or HTTP POST without further
       munging.

The handler classification table is intentionally explicit (rather than
inferred) so adding a new tool is a one-line change and the operator
knows exactly where the call ends up.
"""

from __future__ import annotations

import json
import math
import os
import re
import time
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional

import httpx


SCHEMA_PATH = Path(__file__).parent / "tools" / "schema.json"
BLOCKOPS_BACKEND_URL = os.getenv("BLOCKOPS_BACKEND_URL", "http://localhost:3000")
CASPER_RPC_URL = os.getenv("CASPER_RPC_URL", "https://rpc.testnet.casper.live/rpc")
CSPR_CLOUD_API_URL = os.getenv("CSPR_CLOUD_API_URL", "https://api.testnet.cspr.cloud")
CSPR_CLOUD_API_KEY = os.getenv("CSPR_CLOUD_API_KEY", "")
COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price"
FAUCET_URL = os.getenv("CASPER_FAUCET_URL", "https://testnet.cspr.live/tools/faucet")
EXPLORER_BASE_URL = os.getenv("CASPER_EXPLORER_BASE_URL", "https://testnet.cspr.live")


# ---------------------------------------------------------------------------
# Catalog loading
# ---------------------------------------------------------------------------
def load_catalog() -> Dict[str, Any]:
    with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def tool_index(catalog: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """Index tools by name for O(1) lookup."""
    return {t["name"]: t for t in catalog.get("tools", [])}


CATALOG = load_catalog()
TOOLS: Dict[str, Dict[str, Any]] = tool_index(CATALOG)


def list_tools_payload() -> Dict[str, Any]:
    """Return the full tool catalog (matches `GET /mcp/tools`)."""
    return {"tools": CATALOG.get("tools", [])}


def list_tool_names() -> List[str]:
    return [t["name"] for t in CATALOG.get("tools", [])]


def get_tool(name: str) -> Optional[Dict[str, Any]]:
    return TOOLS.get(name)


# ---------------------------------------------------------------------------
# Handler classification
# ---------------------------------------------------------------------------
# Tools that should be computed locally (no network).
LOCAL_TOOLS = {"calculate"}

# Tools that should hit Casper RPC or CSPR.cloud directly (read-only).
RPC_TOOLS = {
    "get_balance",
    "get_token_info",
    "get_token_balance",
    "get_nft_info",
    "lookup_deploy",
    "lookup_block",
    "fetch_price",
    "get_reputation",
    "wallet_readiness",
}

# Everything else (write tools, paid tools) proxies to the BlockOps backend
# `/v1/tools/:toolId` endpoint that Phase 20 wired up.


def classify(tool: str) -> str:
    if tool in LOCAL_TOOLS:
        return "local"
    if tool in RPC_TOOLS:
        return "rpc"
    return "proxy"


# ---------------------------------------------------------------------------
# Casper RPC + CSPR.cloud helpers (shared with mcp_server_sse)
# ---------------------------------------------------------------------------
async def rpc(method: str, params: Any = None) -> Dict[str, Any]:
    payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or []}
    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(CASPER_RPC_URL, json=payload, timeout=15.0)
            r.raise_for_status()
            data = r.json()
        if "error" in data:
            return {"error": data["error"]}
        return data.get("result", {}) or {}
    except Exception as e:  # pragma: no cover - depends on network
        return {"error": f"rpc_error: {e!s}"}


async def cspr_cloud(endpoint: str) -> Dict[str, Any]:
    headers = {"Accept": "application/json"}
    if CSPR_CLOUD_API_KEY:
        headers["Authorization"] = f"Bearer {CSPR_CLOUD_API_KEY}"
    url = f"{CSPR_CLOUD_API_URL.rstrip('/')}/{endpoint.lstrip('/')}"
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(url, headers=headers, timeout=15.0)
        if r.status_code == 200:
            return r.json()
        return {"error": f"cspr_cloud_http_{r.status_code}"}
    except Exception as e:  # pragma: no cover
        return {"error": f"cspr_cloud_error: {e!s}"}


def safe_calculate(params: Dict[str, Any]) -> Dict[str, Any]:
    """Compute a math expression. Mirrors backend/services/directToolExecutor.js
    safeCalculate so the result is identical to what the backend returns."""
    expression = (params or {}).get("expression") or ""
    variables = (params or {}).get("variables") or (params or {}).get("values") or {}
    description = (params or {}).get("description") or "Calculation"

    if isinstance(variables, str):
        try:
            variables = json.loads(variables)
        except Exception:
            variables = {}
    if not isinstance(variables, dict):
        variables = {}

    resolved = " ".join(expression.split())

    # Substitute variables (longest first to avoid partial overlaps).
    for name in sorted(variables.keys(), key=len, reverse=True):
        try:
            num = float(str(variables[name]).replace(",", ""))
        except (TypeError, ValueError):
            return {"success": False, "tool": "calculate",
                    "error": f"Variable '{name}' has non-numeric value: {variables[name]}"}
        pattern = re.compile(r"\b" + re.escape(str(name)) + r"\b")
        resolved = pattern.sub(str(num), resolved)
    resolved = " ".join(resolved.split())

    allowed = set("0123456789+-*/().eE ")
    if not all(c in allowed for c in resolved):
        bad = [c for c in resolved if c not in allowed]
        return {"success": False, "tool": "calculate",
                "error": f"Invalid characters: [{', '.join(bad)}]"}

    try:
        # Safe eval: whitelist of characters above blocks anything dangerous.
        result = eval(resolved, {"__builtins__": {}}, {})
    except Exception as e:
        return {"success": False, "tool": "calculate",
                "error": f"Calculation error: {e}"}

    return {
        "success": True,
        "tool": "calculate",
        "result": {
            "original_expression": expression,
            "variables": variables,
            "resolved_expression": resolved,
            "result": result,
            "description": description,
        },
    }


# ---------------------------------------------------------------------------
# RPC-backed handlers
# ---------------------------------------------------------------------------
async def _rpc_get_balance(params: Dict[str, Any]) -> Dict[str, Any]:
    pk = (params or {}).get("public_key")
    if not pk:
        return {"error": "public_key is required"}
    cloud = await cspr_cloud(f"/accounts/{pk}/balance")
    if "error" in cloud:
        # Best-effort fallback: hit the RPC for the purse uref.
        root = await rpc("chain_get_state_root_hash")
        if "error" in root:
            return cloud
        return {
            "public_key": pk,
            "balance_motes": "0",
            "balance_cspr": "0.00",
            "source": "cspr_cloud_error",
            "cspr_cloud_error": cloud.get("error"),
        }
    motes = int(cloud.get("balance", 0) or 0)
    return {
        "public_key": pk,
        "balance_motes": str(motes),
        "balance_cspr": f"{motes / 1_000_000_000:.4f}",
        "source": "cspr_cloud",
    }


async def _rpc_get_token_info(params: Dict[str, Any]) -> Dict[str, Any]:
    contract_hash = (params or {}).get("contract_hash")
    if not contract_hash:
        return {"error": "contract_hash is required"}
    return await cspr_cloud(f"/tokens/{contract_hash.strip('contract-')}/info")


async def _rpc_get_token_balance(params: Dict[str, Any]) -> Dict[str, Any]:
    contract_hash = (params or {}).get("contract_hash")
    pk = (params or {}).get("public_key")
    if not contract_hash or not pk:
        return {"error": "contract_hash and public_key are required"}
    return await cspr_cloud(
        f"/tokens/{contract_hash.strip('contract-')}/balances/{pk}"
    )


async def _rpc_get_nft_info(params: Dict[str, Any]) -> Dict[str, Any]:
    collection_hash = (params or {}).get("collection_hash")
    token_id = (params or {}).get("token_id")
    if not collection_hash:
        return {"error": "collection_hash is required"}
    base = f"/nft/{collection_hash.strip('contract-')}"
    if token_id is not None:
        base += f"/tokens/{token_id}"
    return await cspr_cloud(base)


async def _rpc_lookup_deploy(params: Dict[str, Any]) -> Dict[str, Any]:
    deploy_hash = (params or {}).get("deploy_hash")
    if not deploy_hash:
        return {"error": "deploy_hash is required"}
    return await rpc("info_get_deploy", {"deploy_hash": deploy_hash})


async def _rpc_lookup_block(params: Dict[str, Any]) -> Dict[str, Any]:
    ident = (params or {}).get("block_identifier") or (params or {}).get("block_height") or "latest"
    return await rpc("chain_get_block", {"block_identifier": ident})


async def _rpc_fetch_price(_params: Dict[str, Any]) -> Dict[str, Any]:
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                COINGECKO_URL,
                params={"ids": "casper-network", "vs_currencies": "usd", "include_24hr_change": "true"},
                timeout=10.0,
            )
        if r.status_code != 200:
            return {"error": f"coingecko_http_{r.status_code}"}
        data = r.json().get("casper-network", {})
        return {
            "token": "CSPR",
            "price_usd": data.get("usd"),
            "change_24h": data.get("usd_24h_change"),
            "source": "coingecko",
        }
    except Exception as e:  # pragma: no cover
        return {"error": f"price_error: {e!s}"}


async def _rpc_get_reputation(params: Dict[str, Any]) -> Dict[str, Any]:
    contract_hash = os.getenv("CASPER_REPUTATION_HASH", "")
    agent_id = (params or {}).get("agent_id") or ""
    if not contract_hash:
        return {"error": "CASPER_REPUTATION_HASH env var not set"}
    if not agent_id:
        return {"error": "agent_id is required"}
    key = agent_id.replace("-", "_")
    return await rpc(
        "query_global_state",
        {"key": contract_hash, "path": [f"rating_{key}"]},
    )


async def _rpc_wallet_readiness(params: Dict[str, Any]) -> Dict[str, Any]:
    address = (params or {}).get("public_key") or (params or {}).get("address")
    if not address:
        return {"error": "public_key is required"}
    bal = await _rpc_get_balance({"public_key": address})
    if "error" in bal and bal.get("balance_motes") is None:
        return {"error": bal["error"]}
    try:
        motes = int(bal.get("balance_motes", 0))
    except (TypeError, ValueError):
        motes = 0
    funded = motes > 0
    return {
        "success": True,
        "address": address,
        "balance_cspr": f"{motes / 1_000_000_000:.4f}",
        "balance_motes": str(motes),
        "readiness": "ready" if funded else "needs_funding",
        "funded": funded,
        "faucet_url": FAUCET_URL,
        "explorer_url": f"{EXPLORER_BASE_URL}/account/{address}",
        "next_action": (
            "Wallet is funded and ready for Casper automation tools."
            if funded
            else "Wallet has no CSPR yet. Fund it from the Casper testnet faucet before running transfers or agent workflows."
        ),
        "recommended_tools": (
            ["transfer", "register_agent", "attest_agent", "yield_rebalance",
             "deploy_cep18", "deploy_cep78"] if funded else ["wallet_readiness"]
        ),
    }


RPC_HANDLERS: Dict[str, Callable[[Dict[str, Any]], Awaitable[Dict[str, Any]]]] = {
    "get_balance": _rpc_get_balance,
    "get_token_info": _rpc_get_token_info,
    "get_token_balance": _rpc_get_token_balance,
    "get_nft_info": _rpc_get_nft_info,
    "lookup_deploy": _rpc_lookup_deploy,
    "lookup_block": _rpc_lookup_block,
    "fetch_price": _rpc_fetch_price,
    "get_reputation": _rpc_get_reputation,
    "wallet_readiness": _rpc_wallet_readiness,
}


# ---------------------------------------------------------------------------
# Backend proxy
# ---------------------------------------------------------------------------
async def _proxy(tool: str, params: Dict[str, Any],
                 headers: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """Forward to the BlockOps backend `/v1/tools/:toolId`.

    The proxy transparently passes any x402 payment headers the caller
    supplied so the client can sign a deploy and retry without re-plumbing.
    If the backend returns 402, the challenge body is returned as-is so the
    MCP client (LangGraph / CrewAI / stdio) can react.
    """
    forward_headers: Dict[str, str] = {"content-type": "application/json"}
    if headers:
        # Only forward headers that the backend's x402 middleware cares about.
        for h in ("x-casper-payment-deploy-hash", "x-casper-payment-payer-publickey",
                  "x-api-key", "x-request-id"):
            v = headers.get(h) or headers.get(h.title()) or headers.get(h.upper())
            if v:
                forward_headers[h] = v

    url = f"{BLOCKOPS_BACKEND_URL.rstrip('/')}/v1/tools/{tool}"
    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(url, json=params or {}, headers=forward_headers, timeout=30.0)
        try:
            body = r.json()
        except Exception:
            body = {"raw": r.text}
        if r.status_code >= 400:
            return {
                "error": body.get("error") or f"backend_http_{r.status_code}",
                "status": r.status_code,
                "challenge": body if r.status_code == 402 else None,
                "details": body,
            }
        return body
    except httpx.ConnectError:
        return {"error": f"backend_unreachable: {url}"}
    except Exception as e:  # pragma: no cover
        return {"error": f"proxy_error: {e!s}"}


# ---------------------------------------------------------------------------
# Unified dispatch
# ---------------------------------------------------------------------------
async def dispatch(tool: str,
                   params: Optional[Dict[str, Any]] = None,
                   *,
                   headers: Optional[Dict[str, str]] = None,
                   request_id: Optional[str] = None) -> Dict[str, Any]:
    """Dispatch a tool call. Returns a JSON-serialisable dict."""
    started = time.time()
    params = params or {}
    meta: Dict[str, Any] = {"tool": tool, "request_id": request_id}

    if not tool:
        return {"error": "missing 'tool' field"}

    if tool not in TOOLS:
        return {"error": f"unknown tool: {tool}", "known_tools": list_tool_names()}

    kind = classify(tool)
    meta["kind"] = kind
    meta["tier"] = TOOLS[tool].get("tier")
    meta["price_motes"] = TOOLS[tool].get("price_motes")

    try:
        if kind == "local":
            result = safe_calculate(params)
        elif kind == "rpc":
            handler = RPC_HANDLERS.get(tool)
            if handler is None:
                return {**meta, "error": f"rpc handler missing for {tool}"}
            result = await handler(params)
        else:  # proxy
            result = await _proxy(tool, params, headers=headers)
    except Exception as e:
        return {**meta, "error": f"dispatch_error: {e!s}",
                "duration_ms": int((time.time() - started) * 1000)}

    if isinstance(result, dict) and "error" in result and "tool" not in result:
        # Normalise so the caller always sees {tool, success, ...}.
        return {**meta, "success": False, "error": result["error"], **result,
                "duration_ms": int((time.time() - started) * 1000)}
    return {**meta, "success": True, "result": result,
            "duration_ms": int((time.time() - started) * 1000)}


__all__ = [
    "CATALOG", "TOOLS",
    "list_tools_payload", "list_tool_names", "get_tool",
    "classify",
    "dispatch",
    "rpc", "cspr_cloud", "safe_calculate",
    "BLOCKOPS_BACKEND_URL",
]
