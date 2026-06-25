# CasperOPs MCP Server

The CasperOPs MCP (Model Context Protocol) server exposes the 19 Casper-native
backend tools to LangGraph, CrewAI, n8n, and any other MCP-compatible agent
runtime over a single tool surface.

## Features

- **19 tools** covering native CSPR transfers, CEP-18/CEP-78 token + NFT
  operations, agent registry + reputation, escrow, and market data
  (see [`tools/schema.json`](./tools/schema.json)). The catalog is loaded
  once at import time and serves as the single source of truth for both
  transports.
- **Two transports**:
  - **stdio JSON-RPC** — for n8n and any local CLI that consumes a child
    process.
  - **HTTP / SSE** — for remote LangGraph / CrewAI agents hosted on
    Railway / Fly / Render. Endpoints: `GET /mcp/sse`, `POST /mcp/message`,
    `GET /mcp/tools`.
- **Unified dispatcher** (`dispatcher.py`) — every tool is classified as
  `local` (compute in-process), `rpc` (Casper RPC + CSPR.cloud), or
  `proxy` (forward to the CasperOPs backend `/v1/tools/:toolId`). Adding a
  new tool is a one-line classification change.
- **Stateful sessions** — Redis (1-hour TTL) for short-term session
  metadata + Postgres for long-term tool-call history. Both are optional;
  the server runs without them.
- **x402 payment protocol** — paid tools require an
  `X-Casper-Payment-Deploy-Hash` header on the underlying tool call. The
  MCP layer is a passthrough — payment is enforced by the CasperOPs backend
  middleware.

## Architecture

```
                 ┌────────────┐
    n8n          │            │      ┌──────────────┐
    (stdio) ───► │ mcp_server │ ───► │ dispatcher.py│
                 │  .py       │      │   (single    │
    LangGraph ─► │            │      │   source of  │  ┌──────────────┐
    (SSE)    ──► │ mcp_server │      │    truth)    │─►│ Casper RPC   │
                 │  _sse.py   │      │              │  │ CSPR.cloud   │
    CrewAI  ───► │            │      └──────┬───────┘  │ CasperOPs API │
                 └─────┬──────┘             │          └──────────────┘
                       │                    │
                  ┌────▼─────┐         ┌────▼─────┐
                  │  Redis   │         │ Postgres │
                  │  (state) │         │ (history)│
                  └──────────┘         └──────────┘
```

## Quick start

### Install dependencies

```bash
cd n8n_agent_backend
python -m venv .venv
.venv/bin/pip install -r requirements.txt
```

For the LangGraph + CrewAI examples:

```bash
.venv/bin/pip install langgraph langchain-core
.venv/bin/pip install crewai          # requires Python 3.12/3.13
```

### Run the stdio transport (for n8n / local CLI)

```bash
.venv/bin/python mcp_server.py
```

The server speaks newline-delimited JSON-RPC 2.0 on stdin/stdout:

```json
{"jsonrpc":"2.0","id":1,"method":"tools/list"}
{"jsonrpc":"2.0","id":2,"method":"tools/call",
 "params":{"name":"calculate","arguments":{"expression":"2+2"}}}
```

### Run the HTTP/SSE transport (for remote LangGraph / CrewAI)

```bash
.venv/bin/uvicorn mcp_server_sse:app --host 0.0.0.0 --port 8080
```

Endpoints:

| Method | Path                | Description                                         |
| ------ | ------------------- | --------------------------------------------------- |
| GET    | `/`                  | Server info + tool summary                          |
| GET    | `/health`            | Liveness probe                                      |
| GET    | `/mcp/tools`         | Full tool catalog (from `tools/schema.json`)        |
| GET    | `/mcp/sse`           | Open SSE stream — client pushes via `/mcp/message`  |
| POST   | `/mcp/message`       | JSON-RPC 2.0 dispatch (single message → single reply) |
| POST   | `/mcp`               | Legacy single-shot `{tool, params}` POST            |
| GET    | `/mcp/list`          | Flat list of tool names (back-compat)               |
| GET    | `/mcp/recent/{sid}`  | Recent tool-call history for a session              |

### Example: register an agent via LangGraph

```bash
# 1. Start the MCP server in one terminal
.venv/bin/uvicorn mcp_server_sse:app --host 0.0.0.0 --port 8080

# 2. Run the example
.venv/bin/python examples/langgraph_agent.py --mcp-url http://localhost:8080/mcp
```

The example runs the deterministic pipeline
`register_agent → attest_agent → get_reputation` and prints the result of
each step. Pass `--agent-id <id>` to override the default agent id.

### Example: register an agent via CrewAI

```bash
.venv/bin/pip install crewai
.venv/bin/python examples/crewai_agent.py --mcp-url http://localhost:8080/mcp
```

The CrewAI example has two modes:

- `--deterministic` — drives the same three tool calls as the LangGraph
  example without an LLM. Use this in CI / smoke tests.
- (default) — full CrewAI agent with `ChatOpenAI` driving a ReAct loop.
  Set `OPENAI_API_KEY` (or another LLM provider) in the env.

## Choosing a transport

| Scenario                                 | Transport                |
| ---------------------------------------- | ------------------------ |
| n8n running on the same host              | stdio (`mcp_server.py`)  |
| LangGraph / CrewAI agent on a remote host | HTTP/SSE                 |
| Local CLI tool you can spawn as a child   | stdio                    |
| Browser / web demo                        | HTTP/SSE + `x402-client` |

The HTTP/SSE transport is recommended for any non-CLI consumer because:
1. It can be deployed once and shared by many agents.
2. Redis-backed session state + Postgres tool-call history are easier to
   reason about (no per-process state).
3. The SSE stream can fan out results to multiple long-lived listeners.

## JSON-RPC protocol

Both transports accept the same JSON-RPC 2.0 envelope:

| Method          | Params                                                     | Result                                       |
| --------------- | ---------------------------------------------------------- | -------------------------------------------- |
| `initialize`    | `{}`                                                       | `{serverInfo, protocolVersion, capabilities}`|
| `ping`          | `{}`                                                       | `{pong: true, ts}`                           |
| `tools/list`    | `{}`                                                       | `{tools: [...]}`                             |
| `tools/call`    | `{name, arguments, _meta?}`                                | `{tool, kind, tier, success, result|error, ...}` |
| `shutdown`      | `{}`                                                       | `{ok: true}`                                 |

For `tools/call`, `_meta` may include:
- `x402_payment_deploy_hash` — forwarded to the backend as
  `X-Casper-Payment-Deploy-Hash`.
- `x402_payment_payer_public_key` — forwarded as
  `X-Casper-Payment-Payer-PublicKey`.
- `request_id` — correlated into the structured log.
- `agent_id` — stored alongside the session.

If the backend returns HTTP 402, the dispatcher surfaces the challenge
back to the agent so it can sign a payment deploy via CSPR.click and
retry — no special handling required on the client.

## Environment variables

| Variable                  | Required | Default                                          | Notes                                              |
| ------------------------- | -------- | ------------------------------------------------ | -------------------------------------------------- |
| `CASPER_RPC_URL`          | no       | `https://rpc.testnet.casper.live/rpc`            | JSON-RPC endpoint                                  |
| `CSPR_CLOUD_API_URL`      | no       | `https://api.testnet.cspr.cloud`                 | Used for balance + token lookups                   |
| `CSPR_CLOUD_API_KEY`      | no       | (empty)                                          | Bearer token for higher rate limits                |
| `CASPEROPS_BACKEND_URL`    | no       | `http://localhost:3000`                          | Where `/v1/tools/:toolId` lives (Phase 20)         |
| `REDIS_URL`               | no       | `redis://localhost:6379/0`                      | Session state; server runs without it              |
| `POSTGRES_DSN`            | no       | (empty)                                          | Tool-call history; server runs without it          |
| `CASPER_REPUTATION_HASH`  | no       | (empty)                                          | Required for `get_reputation` on-chain lookups     |
| `MCP_HTTP_URL`            | no       | `http://localhost:8080/mcp`                      | Default target for the example agents              |

## Tool catalog

19 tools across five categories:

- **Native CSPR** (3): `get_balance`, `transfer`, `batch_transfer`
- **Token / NFT** (6): `deploy_cep18`, `deploy_cep78`, `mint_nft`,
  `get_token_info`, `get_token_balance`, `get_nft_info`
- **On-chain lookups** (3): `lookup_deploy`, `lookup_block`,
  `get_reputation`
- **Agent workflow** (4): `register_agent`, `attest_agent`,
  `wallet_readiness`, (plus `yield_rebalance`)
- **Other** (3): `fetch_price`, `send_email`, `calculate`

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
headers, so the same flow works for both transports.

## Running the smoke tests

```bash
.venv/bin/python -m unittest __tests__.test_smoke -v
```

The suite boots the FastAPI app in a background thread, exercises every
canonical endpoint, spawns the stdio server as a subprocess, and asserts
the unified dispatcher classifies + executes the documented tools. 17
tests, ~1 second runtime, no external services required (Redis/Postgres
are skipped if absent, the CasperOPs backend is treated as optional).

## Deployment

### Railway / Fly / Render

The HTTP/SSE transport is a standard FastAPI app. Deploy with:

```bash
.venv/bin/uvicorn mcp_server_sse:app --host 0.0.0.0 --port $PORT
```

Recommended add-ons:

- **Redis** (Upstash / Railway): `REDIS_URL=redis://...`
- **Postgres** (Neon / Supabase): `POSTGRES_DSN=postgres://...`

### Docker

A `Dockerfile` is included. Build and run:

```bash
docker build -t casperops-mcp .
docker run -p 8080:8080 -e CASPER_RPC_URL=https://rpc.testnet.casper.live/rpc casperops-mcp
```

## Schema reference

The full input/output JSON Schema for every tool is in
[`tools/schema.json`](./tools/schema.json). The schema is loaded by both
transports at import time and served at `GET /mcp/tools`.

## Contributing

Add a new tool:

1. Add the entry to `tools/schema.json` (name, description, input schema,
   tier).
2. Classify the tool in `dispatcher.py`:
   - `LOCAL_TOOLS` — pure computation, no network.
   - `RPC_TOOLS` — read-only Casper RPC + CSPR.cloud lookups.
   - Default → `proxy` to the CasperOPs backend `/v1/tools/:toolId`.
3. Implement the handler in `dispatcher.py` (for `local` / `rpc`).
4. Add an entry to `backend/utils/chains.js TOOL_PRICING` (free or paid
   with a `priceMotes`).
5. (Optional) Wire session storage by calling
   `state.record_call(...)` from the handler.
