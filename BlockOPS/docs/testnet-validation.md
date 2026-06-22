# Casper Testnet Validation Log

This document captures every BlockOps testnet deployment and end-to-end run, including
deploy costs, deploy times, and gotchas. New runs are appended below; do not delete
historical entries.

## Prerequisites

1. Generate a Casper testnet ed25519 keypair:

   ```bash
   cd contract
   node scripts/generate-signer.js
   ```

   The script writes `backend/secrets/testnet-signer.{pem,json}` (both gitignored) and
   prints the public key + private key. Copy the private key (hex, no `0x`) into
   `backend/.env` as `CASPER_SECRET_KEY`.

2. Fund the public key from the
   [Casper Testnet Faucet](https://testnet.cspr.live/tools/faucet). 200 CSPR is enough
   for ~10 contract deploys plus e2e test runs.

3. Build the Odra WASM contracts:

   ```bash
   cd contract
   export RUSTFLAGS="-C link-arg=--unresolved-symbols=import-dynamic"
   cargo odra build
   ```

4. Deploy all four contracts:

   ```bash
   cd contract
   node scripts/deploy.js
   ```

   The script prints the four contract hashes. Copy them into `backend/.env` and
   `frontend/.env.local`:

   ```bash
   CASPER_AGENT_FACTORY_HASH=hash-<64hex>
   CASPER_REPUTATION_HASH=hash-<64hex>
   CASPER_ESCROW_HASH=hash-<64hex>
   CASPER_COMPLIANCE_HASH=hash-<64hex>
   ```

   Frontend mirrors (`NEXT_PUBLIC_*_CONTRACT_HASH`) live in
   [`frontend/lib/contracts.ts`](../frontend/lib/contracts.ts).

## CEP-18 / CEP-78 deploys

BlockOps ships sample CEP-18 (test CSPR) and CEP-78 (test NFT) token contracts in
[`contract/contracts/cep78-token`](../contract/contracts/cep78-token) and
[`contract/contracts/cep18-token`](../contract/contracts/cep18-token). Deploy them with
the same `node scripts/deploy.js` flow (add a `CONTRACTS` entry pointing at the WASM).
The resulting contract hashes are written to
`frontend/lib/contracts.ts` as `NEXT_PUBLIC_CEP18_CONTRACT_HASH` /
`NEXT_PUBLIC_CEP78_CONTRACT_HASH`.

## End-to-end testnet run

```bash
./scripts/e2e-testnet.sh
```

The script runs the canonical agent lifecycle (register → attest → reputation →
escrow deposit → escrow payout → final state) and appends a timestamped log to
this file. Re-run with `--skip-deploy` to skip the deploy step once the four
contract hashes are populated.

## Environment variables

| Variable                                | Required | Notes                                                      |
| --------------------------------------- | -------- | ---------------------------------------------------------- |
| `CASPER_RPC_URL`                        | yes      | default `https://rpc.testnet.casper.live/rpc`              |
| `CSPR_CLOUD_API_URL`                    | yes      | default `https://api.testnet.cspr.cloud`                   |
| `CASPER_SECRET_KEY`                     | yes      | 64-char hex (ed25519 or secp256k1) of funded testnet key   |
| `CASPER_AGENT_FACTORY_HASH`             | yes      | `hash-<64hex>` after `node scripts/deploy.js`              |
| `CASPER_REPUTATION_HASH`                | yes      | `hash-<64hex>`                                              |
| `CASPER_ESCROW_HASH`                    | yes      | `hash-<64hex>`                                              |
| `CASPER_COMPLIANCE_HASH`                | yes      | `hash-<64hex>`                                              |
| `NEXT_PUBLIC_CEP18_CONTRACT_HASH`       | optional | required for CEP-18 x402 payments                          |
| `NEXT_PUBLIC_CEP78_CONTRACT_HASH`       | optional | required for CEP-78 NFT minting in the workflow builder     |

## Deploy cost / time matrix

| Contract     | Approx. cost (CSPR) | Approx. wall time (s) | Notes                                         |
| ------------ | ------------------- | --------------------- | --------------------------------------------- |
| AgentFactory | 250                 | 30–60                 | No constructor args, simplest deploy          |
| Reputation   | 250                 | 30–60                 | `validator_address = self`                    |
| Escrow       | 250                 | 30–60                 | `backend = self`, `treasury = self`           |
| Compliance   | 250                 | 30–60                 | `authority = self`                            |
| CEP-18 token | 250                 | 30–60                 | `name`, `symbol`, `decimals`, `total_supply`  |
| CEP-78 NFT   | 250                 | 30–60                 | `collection_name`, `symbol`, `total_token_supply` |

(All costs are paid as the standard 250 CSPR deploy payment, plus a small CSPR
transaction fee deducted from the deployer balance.)

## Gotchas

- The Casper testnet faucet is rate-limited (one claim per public key per 24 h, max 200
  CSPR per claim). Reuse the same key across deploy runs.
- The first deploy after a faucet claim can take up to 90 s to be picked up by RPC
  indexing; the e2e script polls `info_get_deploy` for 120 s before failing.
- `keys.publicKey.isEd25519()` is the only reliable way to detect algorithm
  compatibility in casper-js-sdk ≥ 2.x; the legacy `Ed25519` /
  `Secp256K1` static methods are gone.
- CSPR.cloud free tier rate-limits aggressively (60 req/min). If the e2e run reports
  `429 Too Many Requests`, add `CSPR_CLOUD_API_KEY` from
  [https://cspr.cloud](https://cspr.cloud).
- If a deploy hangs in "pending", check the deployer account still has CSPR on
  <https://testnet.cspr.live/account/<publicKey>>.

## Run history

<!--
Append-only. Every e2e run appends a new section via scripts/e2e-testnet.mjs.
Do NOT delete historical entries.
-->
