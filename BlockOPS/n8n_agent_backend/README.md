# BlockOps MCP Server

The BlockOps MCP (Model Context Protocol) server exposes the 22 Casper-native
backend tools to LangGraph, CrewAI, and n8n agents over a single transport.

## Features

- **22 tools** covering native CSPR transfers, CEP-18/CEP-78 token + NFT
  operations, agent registry + reputation, escrow, and market data
  (see [`tools/schema.json`](./tools/schema.json)).
- **Two transports**: stdio (for local n8n) and HTTP/SSE (for remote
  LangGraph / CrewAI).
- **Stateful sessions**: Redis-backed session metadata and Postgres-backed
  tool-call history (optional; the server runs without them).
- **x402 payment protocol**: paid tools require an `X-Casper-Payment-Deploy-Hash`
  header on the underlying tool call. The MCP layer is a passthrough — the
  payment is enforced by the BlockOps backend middleware.

## Architecture

```
                 ┌────────────┐
   n8n           │            │      ┌──────────────┐
   (stdio)  ───► │ mcp_server │ ───► │ BlockOps API │
                 │  .py       │      │  (x402 +     │
   LangGraph ─► │            │      │   casper)    │
   (SSE)    ──► │ mcp_server │      │              │
                 │  _sse.py   │      └──────┬───────┘
   CrewAI  ───► │            │             │
                 └─────┬──────┘             │
                       │                    │
                  ┌────▼─────┐         ┌────▼─────┐
                  │  Redis   │         │ Postgres │
                  │ (state)  │         │ (history)│
                  └──────────┘         └──────────┘
```

## Quick start

### Install dependencies

```bash
cd n8n_agent_backend
pip install -r requirements.txt
```

### Run the stdio transport (for n8n / local CLI)

```bash
python mcp_server.py
```

### Run the HTTP/SSE transport (for remote LangGraph / CrewAI)

```bash
uvicorn mcp_server_sse:app --host 0.0.0.0 --port 8080
```

Endpoints:

- `GET  /`        — server info + tool list summary
- `GET  /health`  — health probe
- `GET  /mcp/tools` — full tool catalog with JSON schemas
- `GET  /mcp/list`  — flat tool name list
- `POST /mcp`     — single-shot tool invocation
- `GET  /mcp`     — Server-Sent Events stream

### Example: register an agent via LangGraph

```bash
python examples/langgraph_agent.py --mcp-url http://localhost:8080/mcp
```

### Example: register an agent via CrewAI

```bash
pip install crewai
python examples/crewai_agent.py --mcp-url http://localhost:8080/mcp
```

## Environment variables

| Variable               | Required | Default                                          | Notes                                            |
| ---------------------- | -------- | ------------------------------------------------ | ------------------------------------------------ |
| `CASPER_RPC_URL`       | no       | `https://rpc.testnet.casper.live/rpc`            | JSON-RPC endpoint                                |
| `CSPR_CLOUD_API_URL`   | no       | `https://api.testnet.cspr.cloud`                 | Used for balance + token lookups                 |
| `CSPR_CLOUD_API_KEY`   | no       | (empty)                                          | Bearer token for higher rate limits              |
| `REDIS_URL`            | no       | `redis://localhost:6379/0`                      | Session state; server runs without it            |
| `POSTGRES_DSN`         | no       | (empty)                                          | Tool-call history; server runs without it        |
| `CASPER_REPUTATION_HASH` | no     | (empty)                                          | Used by `get_reputation` for on-chain lookups    |

## Tool catalog

22 tools across five categories:

- **Native CSPR** (3): `get_balance`, `transfer`, `batch_transfer`
- **Token / NFT** (6): `deploy_cep18`, `deploy_cep78`, `mint_nft`,
  `get_token_info`, `get_token_balance`, `get_nft_info`
- **On-chain lookups** (3): `lookup_deploy`, `lookup_block`,
  `get_reputation`
- **Agent workflow** (4): `register_agent`, `attest_agent`,
  `compliance_check`, `wallet_readiness`
- **Other** (6): `fetch_price`, `send_email`, `calculate`,
  `escrow_deposit`, `escrow_payout`, `yield_rebalance`

Pricing tiers (CSPR per call) live in `backend/utils/chains.js TOOL_PRICING`.
See [`docs/x402.md`](../docs/x402.md) for the payment protocol.

## x402 payment flow

For paid tools, the client must:

1. Call the tool → receive `HTTP 402` with a `deployTemplate`.
2. Sign the deploy via CSPR.click (`frontend/lib/x402-client.ts` automates
   this for the browser).
3. Retry the tool call with `X-Casper-Payment-Deploy-Hash: <deployHash>`
   and `X-Casper-Payment-Payer-PublicKey: <signerPK>`.

The MCP server itself does not enforce payment — that's the backend's job
(`backend/middleware/x402-verify.js`). The MCP layer just forwards the
headers.

## Deployment

### Railway / Fly / Render

The HTTP/SSE transport is a standard FastAPI app. Deploy with:

```bash
uvicorn mcp_server_sse:app --host 0.0.0.0 --port $PORT
```

Recommended add-ons:

- **Redis** (Upstash / Railway): `REDIS_URL=redis://...`
- **Postgres** (Neon / Supabase): `POSTGRES_DSN=postgres://...`

### Docker

A `Dockerfile` is included. Build and run:

```bash
docker build -t blockops-mcp .
docker run -p 8080:8080 -e CASPER_RPC_URL=https://rpc.testnet.casper.live/rpc blockops-mcp
```

## Schema reference

The full input/output JSON Schema for every tool is in
[`tools/schema.json`](./tools/schema.json). The schema is loaded by the SSE
transport at startup and served at `GET /mcp/tools`.

## Contributing

Add a new tool:

1. Add the entry to `tools/schema.json` (name, description, input schema,
   tier).
2. Implement the handler in `mcp_server_sse.py:_dispatch` (or call the
   corresponding BlockOps backend route).
3. Add an entry to `backend/utils/chains.js TOOL_PRICING` (free or
   paid with a `priceMotes`).
4. (Optional) Add a Supabase row to the `mcp_tool_calls` table by calling
   `state.record_call(...)` from the handler.
