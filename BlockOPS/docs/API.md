# BlockOps API Reference

This document covers all 22 backend tool endpoints. Each endpoint accepts
JSON, enforces x402 payment for paid tools, and returns a JSON response.

Base URL: `https://api.blockops.dev` (production) /
`http://localhost:3000/api` (development)

All paid endpoints require:

- `X-Casper-Payment-Deploy-Hash: <hash>` — the on-chain payment deploy
- `X-Casper-Payment-Payer-PublicKey: <pk>` — the public key that signed it

The x402 client (`frontend/lib/x402-client.ts`) automatically adds these
headers; you should not have to set them manually.

## Pricing legend

- **Free** — no x402 challenge.
- **Paid** — server responds `HTTP 402` with a challenge unless the payment
  header is present. Pricing is in CSPR (1 CSPR = 1e9 motes).

---

## Native CSPR

### `get_balance` — free

Look up the native CSPR balance for a Casper public key.

```http
POST /v1/tools/get_balance
Content-Type: application/json

{ "public_key": "010101010101010101010101010101010101010101010101010101010101010101" }
```

**Response 200**

```json
{
  "public_key": "010101…",
  "balance_motes": "2500000000",
  "balance_cspr": "2.5000"
}
```

### `transfer` — 0.10 CSPR

Sign + broadcast a native CSPR transfer via the operator key
(`CASPER_SECRET_KEY`).

```http
POST /v1/tools/transfer
Content-Type: application/json

{
  "recipient": "010101…",
  "amount_motes": "1000000000",
  "memo": "blockops transfer"
}
```

**Response 200**

```json
{
  "deploy_hash": "abc123…",
  "cost_motes": "100000000",
  "explorer_url": "https://testnet.cspr.live/deploy/abc123…"
}
```

### `batch_transfer` — 0.25 CSPR

Sign + broadcast a batch CSPR transfer (≤ 25 recipients per call).

```http
POST /v1/tools/batch_transfer
Content-Type: application/json

{
  "transfers": [
    { "recipient": "010101…", "amount_motes": "100000000" },
    { "recipient": "020202…", "amount_motes": "200000000" }
  ]
}
```

---

## Token / NFT

### `deploy_cep18` — 5.00 CSPR

Deploy a CEP-18 (ERC-20-equivalent) token contract on Casper Testnet.

```http
POST /v1/tools/deploy_cep18
Content-Type: application/json

{
  "name": "BlockOps Test Token",
  "symbol": "BTT",
  "decimals": 9,
  "total_supply": "1000000000000000000"
}
```

**Response 200**

```json
{
  "deploy_hash": "…",
  "contract_hash": "hash-…",
  "token": { "name": "BlockOps Test Token", "symbol": "BTT", "decimals": 9, "total_supply": "1000000000000000000" }
}
```

### `deploy_cep78` — 7.50 CSPR

Deploy a CEP-78 (ERC-721-equivalent) NFT collection contract.

```http
POST /v1/tools/deploy_cep78
Content-Type: application/json

{
  "name": "BlockOps Sample Collection",
  "symbol": "BOSC",
  "total_supply": 1000
}
```

### `mint_nft` — 0.05 CSPR

Mint a new NFT from a previously deployed CEP-78 collection.

```http
POST /v1/tools/mint_nft
Content-Type: application/json

{
  "collection_hash": "hash-…",
  "recipient": "010101…",
  "metadata_uri": "ipfs://…"
}
```

### `get_token_info` — free

```http
POST /v1/tools/get_token_info
{ "contract_hash": "hash-…" }
```

### `get_token_balance` — free

```http
POST /v1/tools/get_token_balance
{ "contract_hash": "hash-…", "public_key": "010101…" }
```

### `get_nft_info` — free

```http
POST /v1/tools/get_nft_info
{ "collection_hash": "hash-…", "token_id": "1" }
```

---

## On-chain lookups

### `lookup_deploy` — free

```http
POST /v1/tools/lookup_deploy
{ "deploy_hash": "abc123…" }
```

### `lookup_block` — free

```http
POST /v1/tools/lookup_block
{ "block_identifier": { "Height": 1234567 } }
```

### `get_reputation` — free

```http
POST /v1/tools/get_reputation
{ "agent_id": "agent-1" }
```

---

## Agent workflow

### `register_agent` — 0.50 CSPR

Register an AI agent on the Casper `AgentFactory` contract.

```http
POST /v1/tools/register_agent
{
  "agent_id": "agent-1",
  "metadata_uri": "ipfs://…"
}
```

### `attest_agent` — 0.20 CSPR

Submit a positive/negative attestation on the `Reputation` contract.

```http
POST /v1/tools/attest_agent
{
  "agent_id": "agent-1",
  "score": 90,
  "evidence_uri": "ipfs://…"
}
```

`score` is an integer in [0, 100].

### `compliance_check` — free

```http
POST /v1/tools/compliance_check
{ "agent_id": "agent-1", "jurisdiction": "US" }
```

### `wallet_readiness` — free

```http
POST /v1/tools/wallet_readiness
{ "public_key": "010101…" }
```

Returns a readiness score (0–100) for the given account, plus its CSPR
balance and last activity timestamp.

---

## Treasury / DeFi

### `yield_rebalance` — 0.10 CSPR

```http
POST /v1/tools/yield_rebalance
{
  "allocations": [
    { "validator": "validator-1", "weight_bps": 5000 },
    { "validator": "validator-2", "weight_bps": 5000 }
  ]
}
```

`weight_bps` is basis points; the array must sum to 10_000 (100%).

### `escrow_deposit` — paid (varies)

```http
POST /v1/tools/escrow_deposit
{
  "agent_id": "agent-1",
  "amount_motes": "1000000000"
}
```

### `escrow_payout` — paid (varies)

```http
POST /v1/tools/escrow_payout
{ "agent_id": "agent-1" }
```

Triggers an agent payout from the Escrow contract (operator-only).

---

## Utilities

### `fetch_price` — free

```http
POST /v1/tools/fetch_price
```

Returns CSPR price in USD + 24h change.

### `send_email` — 0.02 CSPR

```http
POST /v1/tools/send_email
{
  "to": "user@example.com",
  "subject": "BlockOps",
  "body": "Your agent just completed a task."
}
```

### `calculate` — free

```http
POST /v1/tools/calculate
{ "expression": "(2 + 3) * 4" }
```

---

## Error responses

All endpoints return JSON in the shape:

```json
{ "error": "human-readable message" }
```

| Status | Meaning                                              |
| ------ | ---------------------------------------------------- |
| 200    | Success                                              |
| 400    | Validation error (zod schema failed)                 |
| 401    | Missing or invalid auth                              |
| 402    | Missing payment (x402 challenge returned)            |
| 404    | Unknown tool                                         |
| 429    | Rate limit exceeded                                  |
| 500    | Backend error                                        |
| 502    | Upstream (Casper RPC / CSPR.cloud) failure           |

See [`docs/x402.md`](./x402.md) for the full 402 challenge shape.
