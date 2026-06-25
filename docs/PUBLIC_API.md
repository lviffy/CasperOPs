# BlockOps Public API (v1.0)

> **Audience:** external developers integrating with BlockOps.
> For the full internal reference (admin endpoints, debugging hooks),
> see [`API.md`](./API.md).

This document covers every endpoint we publicly commit to. We follow
[Semantic Versioning](https://semver.org/) — breaking changes only
land in major releases.

## Conventions

- **Base URL:** `https://api.blockops.example`
- **Auth:** send `x-api-key: <your-key>` on every request (mint one
  at [/api-keys](https://blockops.example/api-keys) after signing in
  with CSPR.click)
- **Content-Type:** `application/json` on every request with a body
- **Request IDs:** every response echoes `X-Request-Id`; include it
  in bug reports
- **Rate limits:** `X-RateLimit-Limit`, `X-RateLimit-Remaining`,
  `X-RateLimit-Reset`, `Retry-After` headers on every response
- **Errors:** `{ "success": false, "error": "<message>", "requestId": "..." }`
  with the appropriate HTTP status code

## Authentication

### `GET /v1/tools`

Returns the canonical tool catalog. **Free, no auth required.**

```bash
curl https://api.blockops.example/v1/tools
```

```json
{
  "success": true,
  "count": 22,
  "tools": [
    { "name": "get_balance", "description": "…", "x402_required": false, "price_motes": "0" },
    { "name": "register_agent", "description": "…", "x402_required": true, "price_motes": "2500000000" }
  ]
}
```

### `POST /v1/tools/:toolId`

Invoke any tool. **Auth required.** Returns 200 (success), 400
(validation), 402 (paid tool without payment), 429 (rate limited), or
5xx (server error).

```bash
curl -X POST https://api.blockops.example/v1/tools/get_balance \
  -H "x-api-key: $BLOCKOPS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"params": {"address": "010101…01"}}'
```

```json
{
  "success": true,
  "toolId": "get_balance",
  "result": { "balance": "123.4567", "balance_motes": "123456700000" },
  "requestId": "8b3e1d2f-7c4a-4a59-b6e2-3e8e2c2d5d44"
}
```

### x402 paid tools

For paid tools (e.g. `register_agent`, `attest_agent`):

1. Send the request without the payment header → receive 402 with a
   challenge envelope containing the deploy template
2. Sign the deploy via CSPR.click (or your wallet of choice)
3. Broadcast the signed deploy (or let CSPR.click do it)
4. Re-send the original request with `X-Casper-Payment-Deploy-Hash:
   <hash>` set
5. The backend verifies the deploy landed + covers the price, then
   executes the tool

Full spec: [`x402.md`](./x402.md)

## Endpoints

### Health

| Endpoint | Purpose | Auth |
|----------|---------|------|
| `GET /health` | Service info + supported chains | None |
| `GET /health/live` | Liveness probe (always 200 if process up) | None |
| `GET /health/ready` | Readiness (200 if every dependency reachable) | None |
| `GET /health/startup` | Cold-start tolerant readiness | None |
| `GET /metrics` | Prometheus exposition | Bearer token (internal only) |

### Tools (v1 surface)

All 22 tools live under `POST /v1/tools/:toolId`. See `/v1/tools` for
the canonical list. The most-used subset:

| Tool | Tier | Price (CSPR) | Notes |
|------|------|--------------|-------|
| `get_balance` | free | 0 | Read via CSPR.cloud with RPC fallback |
| `get_token_info` | free | 0 | CEP-18 contract metadata |
| `get_token_balance` | free | 0 | CEP-18 per-account balance |
| `get_nft_info` | free | 0 | CEP-78 collection + token metadata |
| `lookup_deploy` | free | 0 | Deploy status, execution result, transfers |
| `lookup_block` | free | 0 | Block header by height or hash |
| `fetch_price` | free | 0 | CSPR/USD via CoinGecko |
| `get_reputation` | free | 0 | On-chain agent reputation |
| `wallet_readiness` | free | 0 | Is the wallet funded + ready? |
| `calculate` | free | 0 | Safe math expression evaluator |
| `attest_agent` | paid | 2.5 | Sign an attestation deploy |
| `register_agent` | paid | 2.5 | Register a new agent deploy |
| `transfer` | write | 0.1 + amount | Native CSPR transfer |
| `batch_transfer` | write | 0.1 × N | Native CSPR batch transfer |
| `mint_nft` | write | 0.5 + storage | CEP-78 mint |
| `deploy_cep18` | write | 5 | Deploy a new CEP-18 token |
| `deploy_cep78` | write | 5 | Deploy a new CEP-78 NFT collection |
| `send_email` | write | 0 | Off-chain SMTP send |
| `schedule_reminder` | write | 0 | node-cron scheduled action |
| `list_reminders` | free | 0 | Read the user's scheduled reminders |
| `cancel_reminder` | write | 0 | Cancel a scheduled reminder |
| `yield_rebalance` | write | 0 | Recommendation (off-chain) |

### Casper-native routes

These predate the v1 surface but remain supported. Prefer `/v1/tools`
for new code.

| Endpoint | Tool |
|----------|------|
| `GET /price/token` | `fetch_price` |
| `GET /balance/:address` | `get_balance` |
| `POST /token/deploy` | `deploy_cep18` |
| `GET /token/info/:tokenHash` | `get_token_info` |
| `GET /token/balance/:tokenHash/:ownerAddress` | `get_token_balance` |
| `POST /nft/deploy-collection` | `deploy_cep78` |
| `POST /nft/mint` | `mint_nft` |
| `POST /transfer` | `transfer` |
| `GET /chain/deploy/:deployHash` | `lookup_deploy` |
| `GET /chain/block/:blockHeight` | `lookup_block` |

### Webhooks

| Endpoint | Purpose |
|----------|---------|
| `POST /webhooks` | Register a webhook for tool-completion events |
| `GET /webhooks` | List the user's webhooks |

### Conversation

| Endpoint | Purpose |
|----------|---------|
| `POST /api/chat` | Free-form chat → AI routes to tools (requires CSPR.click for tool execution) |

## Rate limits

| Tier | Per-minute cap |
|------|---------------|
| free | 60 |
| pro | 600 |
| enterprise | 6,000 |

Per-tool caps (independent of tier caps):

- Free tools: 60 / min
- Paid tools: 20 / min
- Write tools: 10 / min

When you exceed a cap, the response is 429 with `Retry-After`. Back
off and retry; do NOT busy-loop.

## Errors

Every error response has the shape:

```json
{
  "success": false,
  "error": "Human-readable message",
  "requestId": "8b3e1d2f-7c4a-4a59-b6e2-3e8e2c2d5d44",
  "toolId": "transfer"  // when applicable
}
```

| Status | Meaning |
|--------|---------|
| 400 | Validation failed (bad params) |
| 401 | Missing or invalid API key |
| 402 | Paid tool — challenge envelope in body, pay and retry |
| 403 | Key valid but revoked or insufficient permissions |
| 404 | Endpoint or tool not found |
| 429 | Rate limited — `Retry-After` tells you when to retry |
| 5xx | Server error — `requestId` is the key for support tickets |

## Versioning

The API is versioned via the URL prefix (`/v1/`). We follow SemVer:

- `/v1/` — current stable
- `/v2/` — not yet released; will land in 2027
- Breaking changes require a major version bump + 6 months deprecation
  notice

## SDKs

- TypeScript: `@blockops/sdk` (planned for Q+1)
- Python: `blockops` (planned for Q+1)
- Raw HTTP works for any language — the JSON shapes are stable

## Support

- Discord: `https://discord.gg/blockops` (community)
- Email: `support@blockops.example` (Pro tier, 24 h SLA)
- Slack Connect: included for Enterprise tier

## Changelog

See `/changelog` on the dashboard or [`docs/CHANGELOG.md`](./CHANGELOG.md)
for the full release history.