# Casper Testnet Validation Log

This document captures every CasperOPs testnet deployment and end-to-end run, including
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

CasperOPs ships sample CEP-18 (test CSPR) and CEP-78 (test NFT) token contracts in
[`contract/contracts/cep78-token`](../contract/contracts/cep78-token) and
[`contract/contracts/cep18-token`](../contract/contracts/cep18-token). Deploy them with
the same `node scripts/deploy.js` flow (add a `CONTRACTS` entry pointing at the WASM).
The resulting contract hashes are written to
`frontend/lib/contracts.ts` as `NEXT_PUBLIC_CEP18_CONTRACT_HASH` /
`NEXT_PUBLIC_CEP78_CONTRACT_HASH`.

## Phase 22: live testnet re-deployment + v1.0 validation

The Phase 17 hardening changes (`set_paused`, `transfer_ownership`,
`set_treasury`, `burn`, on-chain events) are deployed by re-running
`node scripts/deploy.js` against the same funded testnet key. The script
deploys all six WASM binaries:

1. `AgentFactory.wasm` (no init args)
2. `Reputation.wasm` (`validator_address = self`)
3. `Escrow.wasm` (`backend = self`, `treasury = self`)
4. `Compliance.wasm` (`authority = self`)
5. `Cep18Token.wasm` (`name = "Test CSPR"`, `symbol = "tCSPR"`, `decimals = 9`, `total_supply = 1e18`)
6. `Cep78Nft.wasm` (`collection_name`, `collection_symbol`, `total_token_supply = 1000`, `minter = self`)

After deploy, copy the six new hashes into `backend/.env` and
`frontend/lib/contracts.ts`. Then run the v1.0 e2e:

```bash
./scripts/e2e-testnet-phase22.sh            # dryrun (no live RPC)
./scripts/e2e-testnet-phase22.sh --live    # live testnet
```

The dryrun mode uses an in-memory mock of the contract state machine so the
script can be verified in CI without a funded testnet key. The `--live`
mode runs the same flow against the live RPC + CSPR.cloud. Both modes
append a timestamped entry to the Run history below.

### What you need to run the live testnet

1. **Funded testnet keypair.** Run
   `cd contract && node scripts/generate-signer.js`, fund the printed
   public key from the [Casper Testnet Faucet](https://testnet.cspr.live/tools/faucet)
   (200 CSPR is enough for ~10 contract deploys + e2e test runs), and
   copy the secret key into `backend/.env` as `CASPER_SECRET_KEY`.
2. **Built WASMs.** `cd contract && cargo odra build` produces the six
   WASM files Phase 22 needs.
3. **Six contract hashes in `backend/.env`.** Either reuse the hashes
   from a previous deploy or run `node scripts/deploy.js` first.
4. **CSPR.cloud API key (optional).** The free tier rate-limits
   aggressively; an API key from [https://cspr.cloud](https://cspr.cloud)
   removes the throttle. Set `CSPR_CLOUD_API_KEY=…` in `backend/.env`.

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
- The Phase 22 e2e script self-terminates with `SIGKILL` after the run finishes
  so the parent bash script doesn't hang on lingering casper-js-sdk handles
  in the event loop. A non-zero exit (137) from the script is therefore
  expected and treated as success.
- `set_paused` and `transfer_ownership` are owner-only — the deployer that
  ran `node scripts/deploy.js` is the initial owner. To rotate ownership
  on testnet, run `transfer_ownership(new_owner)` from the original owner
  account, then re-anchor any tooling that relies on the previous owner.
- `Cep18Token::burn` and `Cep78Nft::burn` emit on-chain events via
  `casper_event_standard`. CSPR.cloud indexes these after roughly one era
  (≈ 2 min on testnet); an immediate query may return 0 results.
- The `e2e-testnet-phase22.sh` `--live` mode requires the six contract
  hashes in `backend/.env`. If you only have the four legacy hashes, run
  `cd contract && node scripts/deploy.js` first to deploy Cep18 + Cep78.

## Run history

<!--
Append-only. Every e2e run appends a new section via scripts/e2e-testnet.mjs.
Do NOT delete historical entries.
-->

### Phase 22 (v1.0 hardening) — script

Phase 22 re-runs the e2e against the v1.0-hardened WASM binaries. The script
exercises the new surface in addition to the Phase 7/16 lifecycle:

| Step | Entry point                            | Expected result                |
| ---- | -------------------------------------- | ------------------------------ |
|  7   | `Compliance::attest_agent(_, true)`     | emits `Attest`                 |
|  8   | `Compliance::attest_agent(_, false)`    | emits `RevokeAttestation`      |
|  9   | `AgentFactory::set_paused(true)`       | success                        |
| 10   | `AgentFactory::deploy_agent`           | revert (paused)                |
| 11   | `AgentFactory::set_paused(false)`      | success                        |
| 12   | `AgentFactory::deploy_agent`           | success                        |
| 13   | `AgentFactory::transfer_ownership`     | success                        |
| 14   | `AgentFactory::deploy_agent`           | success (deployer still owns)  |
| 14b  | `set_paused(true)` → `deploy_agent`    | revert (negative control)      |
| 15   | `Cep18Token::burn(100)`                | emits `Burn`, balance -= 100   |
| 16   | `Cep78Nft::mint` → `Cep78Nft::burn(1)`| emits `Burn`, burned_count += 1 |
| 17   | `Escrow::set_treasury`                 | success                        |
| 18   | CSPR.cloud event verification          | Attest, RevokeAttestation, Burn |

The `e2e-testnet-phase22.sh` helper runs the same flow either:

- **dryrun (default)** — runs the script against an in-memory mock of the
  Casper state machine. No funded testnet key, no live RPC, no CSPR.cloud
  call. Use this in CI to prove the e2e step sequence is correct.
- **`--live`** — runs against the live testnet RPC + CSPR.cloud. Requires
  a funded `CASPER_SECRET_KEY` and the six contract hashes in
  `backend/.env`.

### Live testnet runs

| Date       | Deployer public key                                | Hashes                                                                                            | Notes |
| ---------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----- |
| _populate_ | `01…`                                              | AgentFactory=`hash-…`, Reputation=`hash-…`, Escrow=`hash-…`, Compliance=`hash-…`, Cep18=`hash-…`, Cep78=`hash-…` | _to be filled after first live run_ |

For each live run, append a row with the deployer public key, the six
contract hashes from `node scripts/deploy.js`, the deploy cost (CSPR), the
deploy wall time (s), and any gotchas observed (e.g. `set_paused` revert
was surfaced as a 402, not 500).

### v1.0 surface on-chain event verification (CSPR.cloud)

The Phase 22 verification step queries CSPR.cloud for `Attest`,
`RevokeAttestation`, and `Burn` events on the deployed contract hashes.
For each live run, record the query URL + sample event payload in a
row below so the audit trail is complete.

| Date       | Contract             | Event name           | CSPR.cloud query URL                                         | Sample event payload |
| ---------- | -------------------- | -------------------- | ------------------------------------------------------------- | -------------------- |
| _populate_ | Compliance (hash-…)  | `Attest`             | `https://api.testnet.cspr.cloud/contracts-events?…&event_name=Attest`            | _to be filled_        |
| _populate_ | Compliance (hash-…)  | `RevokeAttestation`  | `https://api.testnet.cspr.cloud/contracts-events?…&event_name=RevokeAttestation` | _to be filled_        |
| _populate_ | Cep18Token (hash-…)  | `Burn`               | `https://api.testnet.cspr.cloud/contracts-events?…&event_name=Burn`              | _to be filled_        |
| _populate_ | Cep78Nft (hash-…)    | `Burn`               | `https://api.testnet.cspr.cloud/contracts-events?…&event_name=Burn`              | _to be filled_        |
2026-06-22T19:31:11.715Z  # CasperOPs Testnet End-to-End Run (DRYRUN)
2026-06-22T19:31:11.715Z  Deployer: `010101010101010101010101010101010101010101010101010101010101010101` (ed25519 (mock))
2026-06-22T19:31:11.715Z  Mode: in-memory mock (no live RPC, no CSPR.cloud)
2026-06-22T19:31:11.715Z  Factory:   hash-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
2026-06-22T19:31:11.715Z  Reputation: hash-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
2026-06-22T19:31:11.715Z  Escrow:    hash-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
2026-06-22T19:31:11.715Z  Compliance: hash-dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
2026-06-22T19:31:11.715Z  Cep18:     hash-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
2026-06-22T19:31:11.715Z  Cep78:     hash-ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
2026-06-22T19:31:11.715Z  
2026-06-22T19:31:11.715Z  ## 1. register_agent (AgentFactory::deploy_agent)
2026-06-22T19:31:11.716Z    📤  register_agent(agent-1782156671716) submitted: mock-05a591e9ff8d
2026-06-22T19:31:11.716Z  
2026-06-22T19:31:11.716Z  ## 2. attest_agent (Reputation)
2026-06-22T19:31:11.716Z    📤  attest_agent(agent-1782156671716,85) submitted: mock-d20189cfcf56
2026-06-22T19:31:11.716Z  
2026-06-22T19:31:11.716Z  ## 3. get_reputation (view)
2026-06-22T19:31:11.716Z    📊  "mock"
2026-06-22T19:31:11.716Z  
2026-06-22T19:31:11.716Z  ## 4. escrow_deposit
2026-06-22T19:31:11.716Z    📤  escrow_deposit(agent-1782156671716,1.0 CSPR) submitted: mock-46ae18f36352
2026-06-22T19:31:11.716Z  
2026-06-22T19:31:11.716Z  ## 5. escrow_payout
2026-06-22T19:31:11.716Z    📤  escrow_payout(agent-1782156671716) submitted: mock-a5bd76722541
2026-06-22T19:31:11.716Z  
2026-06-22T19:31:11.716Z  ## 6. Final state check (CSPR.cloud)
2026-06-22T19:31:12.717Z    ⚠️  CSPR.cloud check failed: This operation was aborted
2026-06-22T19:31:12.717Z  
2026-06-22T19:31:12.717Z  ## 7. compliance_attest (Compliance::attest_agent, emits Attest)
2026-06-22T19:31:12.717Z    📤  compliance_attest(verified=true) submitted: mock-1128a373b312
2026-06-22T19:31:12.717Z  
2026-06-22T19:31:12.717Z  ## 8. compliance_revoke (verified: true → false, emits RevokeAttestation)
2026-06-22T19:31:12.717Z    📤  compliance_revoke(verified=false) submitted: mock-2f3835878ac3
2026-06-22T19:31:12.717Z  
2026-06-22T19:31:12.717Z  ## 9. set_paused(true) — AgentFactory, owner-only
2026-06-22T19:31:12.717Z    📤  set_paused(true) submitted: mock-9d630cfc5724
2026-06-22T19:31:12.717Z  
2026-06-22T19:31:12.717Z  ## 10. deploy_agent under pause → expect revert
2026-06-22T19:31:12.717Z    ✅  deploy_agent(under_pause) reverted as expected: User: 0 reverted: Error::Paused
2026-06-22T19:31:12.717Z  
2026-06-22T19:31:12.717Z  ## 11. set_paused(false) — resume
2026-06-22T19:31:12.717Z    📤  set_paused(false) submitted: mock-b0089f82b3de
2026-06-22T19:31:12.717Z  
2026-06-22T19:31:12.717Z  ## 12. deploy_agent → expect success
2026-06-22T19:31:12.717Z    📤  deploy_agent(resumed) submitted: mock-c82d7254d02f
2026-06-22T19:31:12.717Z  
2026-06-22T19:31:12.717Z  ## 13. transfer_ownership(new_owner) — owner-only
2026-06-22T19:31:12.717Z    📤  transfer_ownership(01dddddd…) submitted: mock-e6315b83f896
2026-06-22T19:31:12.717Z  
2026-06-22T19:31:12.717Z  ## 14. deploy_agent under old owner → expect revert (post transfer)
2026-06-22T19:31:12.717Z    📤  deploy_agent(post_transfer) submitted: mock-3e9c323e90bb
2026-06-22T19:31:12.717Z  
2026-06-22T19:31:12.717Z  ## 14b. set_paused(true) → deploy_agent reverts (negative control)
2026-06-22T19:31:12.717Z    📤  set_paused(true) [post-transfer] submitted: mock-c07acd4f2012
2026-06-22T19:31:12.717Z    ✅  deploy_agent(under_pause_post_transfer) reverted as expected: User: 0 reverted: Error::Paused
2026-06-22T19:31:12.717Z    📤  set_paused(false) [resume again] submitted: mock-a5b760b63207
2026-06-22T19:31:12.717Z  
2026-06-22T19:31:12.717Z  ## 15. cep18_burn(amount=100) — holder-only, emits Burn
2026-06-22T19:31:12.717Z    📤  cep18_burn(100) submitted: mock-5ee554f2ce98
2026-06-22T19:31:12.717Z  
2026-06-22T19:31:12.717Z  ## 16. cep78_mint + cep78_burn — owner/operator, emits Burn
2026-06-22T19:31:12.717Z    📤  cep78_mint(recipient) submitted: mock-ee27eb9a3412
2026-06-22T19:31:12.717Z    📤  cep78_burn(token_id=1) submitted: mock-b876dbf5b71b
2026-06-22T19:31:12.717Z  
2026-06-22T19:31:12.717Z  ## 17. escrow_set_treasury — backend-only
2026-06-22T19:31:12.717Z    📤  set_treasury(01111111…) submitted: mock-fe2bf4b63a44
2026-06-22T19:31:12.717Z  
2026-06-22T19:31:12.717Z  ## 18. on-chain event verification (CSPR.cloud events feed)
2026-06-22T19:31:12.717Z    📡  Emitted events (mock): {"Attest":2,"RevokeAttestation":1,"Burn":2}
2026-06-22T19:31:12.717Z  
2026-06-22T19:31:12.717Z  Run finished.
2026-06-22T19:31:33.351Z  # CasperOPs Testnet End-to-End Run (DRYRUN)
2026-06-22T19:31:33.351Z  Deployer: `010101010101010101010101010101010101010101010101010101010101010101` (ed25519 (mock))
2026-06-22T19:31:33.351Z  Mode: in-memory mock (no live RPC, no CSPR.cloud)
2026-06-22T19:31:33.351Z  Factory:   hash-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
2026-06-22T19:31:33.351Z  Reputation: hash-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
2026-06-22T19:31:33.351Z  Escrow:    hash-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
2026-06-22T19:31:33.351Z  Compliance: hash-dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
2026-06-22T19:31:33.351Z  Cep18:     hash-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
2026-06-22T19:31:33.351Z  Cep78:     hash-ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
2026-06-22T19:31:33.351Z  
2026-06-22T19:31:33.351Z  ## 1. register_agent (AgentFactory::deploy_agent)
2026-06-22T19:31:33.352Z    📤  register_agent(agent-1782156693351) submitted: mock-52dcd8c8cce5
2026-06-22T19:31:33.352Z  
2026-06-22T19:31:33.352Z  ## 2. attest_agent (Reputation)
2026-06-22T19:31:33.352Z    📤  attest_agent(agent-1782156693351,85) submitted: mock-6d7ef2bfacac
2026-06-22T19:31:33.352Z  
2026-06-22T19:31:33.352Z  ## 3. get_reputation (view)
2026-06-22T19:31:33.352Z    📊  "mock"
2026-06-22T19:31:33.352Z  
2026-06-22T19:31:33.352Z  ## 4. escrow_deposit
2026-06-22T19:31:33.352Z    📤  escrow_deposit(agent-1782156693351,1.0 CSPR) submitted: mock-0d4770d48db0
2026-06-22T19:31:33.352Z  
2026-06-22T19:31:33.352Z  ## 5. escrow_payout
2026-06-22T19:31:33.352Z    📤  escrow_payout(agent-1782156693351) submitted: mock-3b3a7b05dc9d
2026-06-22T19:31:33.352Z  
2026-06-22T19:31:33.352Z  ## 6. Final state check (CSPR.cloud)
2026-06-22T19:31:34.354Z    ⚠️  CSPR.cloud check failed: This operation was aborted
2026-06-22T19:31:34.354Z  
2026-06-22T19:31:34.354Z  ## 7. compliance_attest (Compliance::attest_agent, emits Attest)
2026-06-22T19:31:34.354Z    📤  compliance_attest(verified=true) submitted: mock-a4b5f8ed7dd1
2026-06-22T19:31:34.354Z  
2026-06-22T19:31:34.354Z  ## 8. compliance_revoke (verified: true → false, emits RevokeAttestation)
2026-06-22T19:31:34.354Z    📤  compliance_revoke(verified=false) submitted: mock-a5ec1c18e5d6
2026-06-22T19:31:34.354Z  
2026-06-22T19:31:34.354Z  ## 9. set_paused(true) — AgentFactory, owner-only
2026-06-22T19:31:34.354Z    📤  set_paused(true) submitted: mock-4373258475f9
2026-06-22T19:31:34.354Z  
2026-06-22T19:31:34.354Z  ## 10. deploy_agent under pause → expect revert
2026-06-22T19:31:34.354Z    ✅  deploy_agent(under_pause) reverted as expected: User: 0 reverted: Error::Paused
2026-06-22T19:31:34.354Z  
2026-06-22T19:31:34.354Z  ## 11. set_paused(false) — resume
2026-06-22T19:31:34.354Z    📤  set_paused(false) submitted: mock-73cc994d8a43
2026-06-22T19:31:34.354Z  
2026-06-22T19:31:34.354Z  ## 12. deploy_agent → expect success
2026-06-22T19:31:34.354Z    📤  deploy_agent(resumed) submitted: mock-eb58acaa02ab
2026-06-22T19:31:34.354Z  
2026-06-22T19:31:34.354Z  ## 13. transfer_ownership(new_owner) — owner-only
2026-06-22T19:31:34.354Z    📤  transfer_ownership(01dddddd…) submitted: mock-e5a7fcd34833
2026-06-22T19:31:34.354Z  
2026-06-22T19:31:34.354Z  ## 14. deploy_agent under old owner → expect revert (post transfer)
2026-06-22T19:31:34.354Z    📤  deploy_agent(post_transfer) submitted: mock-147fe4389edd
2026-06-22T19:31:34.354Z  
2026-06-22T19:31:34.354Z  ## 14b. set_paused(true) → deploy_agent reverts (negative control)
2026-06-22T19:31:34.354Z    📤  set_paused(true) [post-transfer] submitted: mock-d1343d454675
2026-06-22T19:31:34.354Z    ✅  deploy_agent(under_pause_post_transfer) reverted as expected: User: 0 reverted: Error::Paused
2026-06-22T19:31:34.354Z    📤  set_paused(false) [resume again] submitted: mock-fc1fd87f5634
2026-06-22T19:31:34.354Z  
2026-06-22T19:31:34.354Z  ## 15. cep18_burn(amount=100) — holder-only, emits Burn
2026-06-22T19:31:34.354Z    📤  cep18_burn(100) submitted: mock-573d6590db94
2026-06-22T19:31:34.354Z  
2026-06-22T19:31:34.354Z  ## 16. cep78_mint + cep78_burn — owner/operator, emits Burn
2026-06-22T19:31:34.354Z    📤  cep78_mint(recipient) submitted: mock-987a99635635
2026-06-22T19:31:34.354Z    📤  cep78_burn(token_id=1) submitted: mock-2bfe9386837f
2026-06-22T19:31:34.354Z  
2026-06-22T19:31:34.354Z  ## 17. escrow_set_treasury — backend-only
2026-06-22T19:31:34.354Z    📤  set_treasury(01111111…) submitted: mock-8d9131eb9ae1
2026-06-22T19:31:34.354Z  
2026-06-22T19:31:34.354Z  ## 18. on-chain event verification (CSPR.cloud events feed)
2026-06-22T19:31:34.354Z    📡  Emitted events (mock): {"Attest":2,"RevokeAttestation":1,"Burn":2}
2026-06-22T19:31:34.354Z  
2026-06-22T19:31:34.354Z  Run finished.
2026-06-22T19:32:06.332Z  # CasperOPs Testnet End-to-End Run (DRYRUN)
2026-06-22T19:32:06.333Z  Deployer: `010101010101010101010101010101010101010101010101010101010101010101` (ed25519 (mock))
2026-06-22T19:32:06.333Z  Mode: in-memory mock (no live RPC, no CSPR.cloud)
2026-06-22T19:32:06.333Z  Factory:   hash-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
2026-06-22T19:32:06.333Z  Reputation: hash-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
2026-06-22T19:32:06.333Z  Escrow:    hash-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
2026-06-22T19:32:06.333Z  Compliance: hash-dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
2026-06-22T19:32:06.333Z  Cep18:     hash-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
2026-06-22T19:32:06.333Z  Cep78:     hash-ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
2026-06-22T19:32:06.333Z  
2026-06-22T19:32:06.333Z  ## 1. register_agent (AgentFactory::deploy_agent)
2026-06-22T19:32:06.333Z    📤  register_agent(agent-1782156726333) submitted: mock-f5bcfec83342
2026-06-22T19:32:06.333Z  
2026-06-22T19:32:06.333Z  ## 2. attest_agent (Reputation)
2026-06-22T19:32:06.333Z    📤  attest_agent(agent-1782156726333,85) submitted: mock-9e97b080fb89
2026-06-22T19:32:06.333Z  
2026-06-22T19:32:06.333Z  ## 3. get_reputation (view)
2026-06-22T19:32:06.333Z    📊  "mock"
2026-06-22T19:32:06.333Z  
2026-06-22T19:32:06.333Z  ## 4. escrow_deposit
2026-06-22T19:32:06.334Z    📤  escrow_deposit(agent-1782156726333,1.0 CSPR) submitted: mock-25404308d52e
2026-06-22T19:32:06.334Z  
2026-06-22T19:32:06.334Z  ## 5. escrow_payout
2026-06-22T19:32:06.334Z    📤  escrow_payout(agent-1782156726333) submitted: mock-58a937c3fa0f
2026-06-22T19:32:06.334Z  
2026-06-22T19:32:06.334Z  ## 6. Final state check (CSPR.cloud)
2026-06-22T19:32:07.335Z    ⚠️  CSPR.cloud check failed: This operation was aborted
2026-06-22T19:32:07.335Z  
2026-06-22T19:32:07.335Z  ## 7. compliance_attest (Compliance::attest_agent, emits Attest)
2026-06-22T19:32:07.335Z    📤  compliance_attest(verified=true) submitted: mock-4ebd972aa4f5
2026-06-22T19:32:07.335Z  
2026-06-22T19:32:07.335Z  ## 8. compliance_revoke (verified: true → false, emits RevokeAttestation)
2026-06-22T19:32:07.335Z    📤  compliance_revoke(verified=false) submitted: mock-44ceb56d8131
2026-06-22T19:32:07.335Z  
2026-06-22T19:32:07.335Z  ## 9. set_paused(true) — AgentFactory, owner-only
2026-06-22T19:32:07.335Z    📤  set_paused(true) submitted: mock-3596ae832af1
2026-06-22T19:32:07.335Z  
2026-06-22T19:32:07.335Z  ## 10. deploy_agent under pause → expect revert
2026-06-22T19:32:07.335Z    ✅  deploy_agent(under_pause) reverted as expected: User: 0 reverted: Error::Paused
2026-06-22T19:32:07.335Z  
2026-06-22T19:32:07.335Z  ## 11. set_paused(false) — resume
2026-06-22T19:32:07.335Z    📤  set_paused(false) submitted: mock-9647fa730012
2026-06-22T19:32:07.335Z  
2026-06-22T19:32:07.335Z  ## 12. deploy_agent → expect success
2026-06-22T19:32:07.335Z    📤  deploy_agent(resumed) submitted: mock-e0adb5000759
2026-06-22T19:32:07.335Z  
2026-06-22T19:32:07.335Z  ## 13. transfer_ownership(new_owner) — owner-only
2026-06-22T19:32:07.335Z    📤  transfer_ownership(01dddddd…) submitted: mock-45f7e3f5249e
2026-06-22T19:32:07.335Z  
2026-06-22T19:32:07.335Z  ## 14. deploy_agent under old owner → expect revert (post transfer)
2026-06-22T19:32:07.335Z    📤  deploy_agent(post_transfer) submitted: mock-111c20689c82
2026-06-22T19:32:07.335Z  
2026-06-22T19:32:07.335Z  ## 14b. set_paused(true) → deploy_agent reverts (negative control)
2026-06-22T19:32:07.335Z    📤  set_paused(true) [post-transfer] submitted: mock-d0482635c7ee
2026-06-22T19:32:07.335Z    ✅  deploy_agent(under_pause_post_transfer) reverted as expected: User: 0 reverted: Error::Paused
2026-06-22T19:32:07.335Z    📤  set_paused(false) [resume again] submitted: mock-a6d6d9f7c9d8
2026-06-22T19:32:07.336Z  
2026-06-22T19:32:07.336Z  ## 15. cep18_burn(amount=100) — holder-only, emits Burn
2026-06-22T19:32:07.336Z    📤  cep18_burn(100) submitted: mock-ea43c0b95a7c
2026-06-22T19:32:07.336Z  
2026-06-22T19:32:07.336Z  ## 16. cep78_mint + cep78_burn — owner/operator, emits Burn
2026-06-22T19:32:07.336Z    📤  cep78_mint(recipient) submitted: mock-dffce0d5e0d8
2026-06-22T19:32:07.336Z    📤  cep78_burn(token_id=1) submitted: mock-a33db2a5031c
2026-06-22T19:32:07.336Z  
2026-06-22T19:32:07.336Z  ## 17. escrow_set_treasury — backend-only
2026-06-22T19:32:07.336Z    📤  set_treasury(01111111…) submitted: mock-4fba6158ee62
2026-06-22T19:32:07.336Z  
2026-06-22T19:32:07.336Z  ## 18. on-chain event verification (CSPR.cloud events feed)
2026-06-22T19:32:07.336Z    📡  Emitted events (mock): {"Attest":2,"RevokeAttestation":1,"Burn":2}
2026-06-22T19:32:07.336Z  
2026-06-22T19:32:07.336Z  Run finished.
2026-06-22T19:33:11.607Z  # CasperOPs Testnet End-to-End Run (DRYRUN)
2026-06-22T19:33:11.607Z  Deployer: `010101010101010101010101010101010101010101010101010101010101010101` (ed25519 (mock))
2026-06-22T19:33:11.607Z  Mode: in-memory mock (no live RPC, no CSPR.cloud)
2026-06-22T19:33:11.607Z  Factory:   hash-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
2026-06-22T19:33:11.607Z  Reputation: hash-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
2026-06-22T19:33:11.607Z  Escrow:    hash-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
2026-06-22T19:33:11.607Z  Compliance: hash-dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
2026-06-22T19:33:11.607Z  Cep18:     hash-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
2026-06-22T19:33:11.607Z  Cep78:     hash-ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
2026-06-22T19:33:11.607Z  
2026-06-22T19:33:11.607Z  ## 1. register_agent (AgentFactory::deploy_agent)
2026-06-22T19:33:11.608Z    📤  register_agent(agent-1782156791607) submitted: mock-1ee6f96c9a23
2026-06-22T19:33:11.608Z  
2026-06-22T19:33:11.608Z  ## 2. attest_agent (Reputation)
2026-06-22T19:33:11.608Z    📤  attest_agent(agent-1782156791607,85) submitted: mock-2d8500d10ce7
2026-06-22T19:33:11.608Z  
2026-06-22T19:33:11.608Z  ## 3. get_reputation (view)
2026-06-22T19:33:11.608Z    📊  "mock"
2026-06-22T19:33:11.608Z  
2026-06-22T19:33:11.608Z  ## 4. escrow_deposit
2026-06-22T19:33:11.608Z    📤  escrow_deposit(agent-1782156791607,1.0 CSPR) submitted: mock-8b44ccface5f
2026-06-22T19:33:11.608Z  
2026-06-22T19:33:11.608Z  ## 5. escrow_payout
2026-06-22T19:33:11.608Z    📤  escrow_payout(agent-1782156791607) submitted: mock-2f1950a365cd
2026-06-22T19:33:11.608Z  
2026-06-22T19:33:11.608Z  ## 6. Final state check (CSPR.cloud)
2026-06-22T19:33:12.608Z    ⚠️  CSPR.cloud check failed: This operation was aborted
2026-06-22T19:33:12.608Z  
2026-06-22T19:33:12.608Z  ## 7. compliance_attest (Compliance::attest_agent, emits Attest)
2026-06-22T19:33:12.609Z    📤  compliance_attest(verified=true) submitted: mock-140126e05e53
2026-06-22T19:33:12.609Z  
2026-06-22T19:33:12.609Z  ## 8. compliance_revoke (verified: true → false, emits RevokeAttestation)
2026-06-22T19:33:12.609Z    📤  compliance_revoke(verified=false) submitted: mock-191b8bc7a68e
2026-06-22T19:33:12.609Z  
2026-06-22T19:33:12.609Z  ## 9. set_paused(true) — AgentFactory, owner-only
2026-06-22T19:33:12.609Z    📤  set_paused(true) submitted: mock-dc8e5e2d280e
2026-06-22T19:33:12.609Z  
2026-06-22T19:33:12.609Z  ## 10. deploy_agent under pause → expect revert
2026-06-22T19:33:12.609Z    ✅  deploy_agent(under_pause) reverted as expected: User: 0 reverted: Error::Paused
2026-06-22T19:33:12.609Z  
2026-06-22T19:33:12.609Z  ## 11. set_paused(false) — resume
2026-06-22T19:33:12.609Z    📤  set_paused(false) submitted: mock-a3723bc001a8
2026-06-22T19:33:12.609Z  
2026-06-22T19:33:12.609Z  ## 12. deploy_agent → expect success
2026-06-22T19:33:12.609Z    📤  deploy_agent(resumed) submitted: mock-01d5e675e406
2026-06-22T19:33:12.609Z  
2026-06-22T19:33:12.609Z  ## 13. transfer_ownership(new_owner) — owner-only
2026-06-22T19:33:12.609Z    📤  transfer_ownership(01dddddd…) submitted: mock-f1d63120e24a
2026-06-22T19:33:12.609Z  
2026-06-22T19:33:12.609Z  ## 14. deploy_agent under old owner → expect revert (post transfer)
2026-06-22T19:33:12.609Z    📤  deploy_agent(post_transfer) submitted: mock-c1814c5cfd8a
2026-06-22T19:33:12.609Z  
2026-06-22T19:33:12.609Z  ## 14b. set_paused(true) → deploy_agent reverts (negative control)
2026-06-22T19:33:12.609Z    📤  set_paused(true) [post-transfer] submitted: mock-7c0299a14ead
2026-06-22T19:33:12.609Z    ✅  deploy_agent(under_pause_post_transfer) reverted as expected: User: 0 reverted: Error::Paused
2026-06-22T19:33:12.609Z    📤  set_paused(false) [resume again] submitted: mock-57e4eeb527ff
2026-06-22T19:33:12.609Z  
2026-06-22T19:33:12.609Z  ## 15. cep18_burn(amount=100) — holder-only, emits Burn
2026-06-22T19:33:12.609Z    📤  cep18_burn(100) submitted: mock-5dc0cafcbbba
2026-06-22T19:33:12.609Z  
2026-06-22T19:33:12.609Z  ## 16. cep78_mint + cep78_burn — owner/operator, emits Burn
2026-06-22T19:33:12.609Z    📤  cep78_mint(recipient) submitted: mock-3cf6ae8ef3b8
2026-06-22T19:33:12.609Z    📤  cep78_burn(token_id=1) submitted: mock-7c9f2cb96343
2026-06-22T19:33:12.609Z  
2026-06-22T19:33:12.609Z  ## 17. escrow_set_treasury — backend-only
2026-06-22T19:33:12.609Z    📤  set_treasury(01111111…) submitted: mock-180bdc50b484
2026-06-22T19:33:12.609Z  
2026-06-22T19:33:12.609Z  ## 18. on-chain event verification (CSPR.cloud events feed)
2026-06-22T19:33:12.609Z    📡  Emitted events (mock): {"Attest":2,"RevokeAttestation":1,"Burn":2}
2026-06-22T19:33:12.609Z  
2026-06-22T19:33:12.609Z  Run finished.
2026-06-22T19:33:24.492Z  # CasperOPs Testnet End-to-End Run (DRYRUN)
2026-06-22T19:33:24.492Z  Deployer: `010101010101010101010101010101010101010101010101010101010101010101` (ed25519 (mock))
2026-06-22T19:33:24.492Z  Mode: in-memory mock (no live RPC, no CSPR.cloud)
2026-06-22T19:33:24.492Z  Factory:   hash-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
2026-06-22T19:33:24.492Z  Reputation: hash-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
2026-06-22T19:33:24.492Z  Escrow:    hash-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
2026-06-22T19:33:24.492Z  Compliance: hash-dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
2026-06-22T19:33:24.492Z  Cep18:     hash-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
2026-06-22T19:33:24.492Z  Cep78:     hash-ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
2026-06-22T19:33:24.492Z  
2026-06-22T19:33:24.493Z  ## 1. register_agent (AgentFactory::deploy_agent)
2026-06-22T19:33:24.493Z    📤  register_agent(agent-1782156804493) submitted: mock-e416246d7768
2026-06-22T19:33:24.493Z  
2026-06-22T19:33:24.493Z  ## 2. attest_agent (Reputation)
2026-06-22T19:33:24.493Z    📤  attest_agent(agent-1782156804493,85) submitted: mock-83d3bb3166f8
2026-06-22T19:33:24.493Z  
2026-06-22T19:33:24.493Z  ## 3. get_reputation (view)
2026-06-22T19:33:24.493Z    📊  "mock"
2026-06-22T19:33:24.493Z  
2026-06-22T19:33:24.493Z  ## 4. escrow_deposit
2026-06-22T19:33:24.493Z    📤  escrow_deposit(agent-1782156804493,1.0 CSPR) submitted: mock-0491f545a8f7
2026-06-22T19:33:24.493Z  
2026-06-22T19:33:24.493Z  ## 5. escrow_payout
2026-06-22T19:33:24.493Z    📤  escrow_payout(agent-1782156804493) submitted: mock-5eaf6633dd99
2026-06-22T19:33:24.493Z  
2026-06-22T19:33:24.493Z  ## 6. Final state check (CSPR.cloud)
2026-06-22T19:33:25.494Z    ⚠️  CSPR.cloud check failed: This operation was aborted
2026-06-22T19:33:25.494Z  
2026-06-22T19:33:25.494Z  ## 7. compliance_attest (Compliance::attest_agent, emits Attest)
2026-06-22T19:33:25.494Z    📤  compliance_attest(verified=true) submitted: mock-27f2f95c4afa
2026-06-22T19:33:25.494Z  
2026-06-22T19:33:25.494Z  ## 8. compliance_revoke (verified: true → false, emits RevokeAttestation)
2026-06-22T19:33:25.494Z    📤  compliance_revoke(verified=false) submitted: mock-75bd426733d9
2026-06-22T19:33:25.494Z  
2026-06-22T19:33:25.494Z  ## 9. set_paused(true) — AgentFactory, owner-only
2026-06-22T19:33:25.494Z    📤  set_paused(true) submitted: mock-dc8eb2eb78c1
2026-06-22T19:33:25.494Z  
2026-06-22T19:33:25.494Z  ## 10. deploy_agent under pause → expect revert
2026-06-22T19:33:25.494Z    ✅  deploy_agent(under_pause) reverted as expected: User: 0 reverted: Error::Paused
2026-06-22T19:33:25.494Z  
2026-06-22T19:33:25.494Z  ## 11. set_paused(false) — resume
2026-06-22T19:33:25.494Z    📤  set_paused(false) submitted: mock-666d800047ba
2026-06-22T19:33:25.494Z  
2026-06-22T19:33:25.494Z  ## 12. deploy_agent → expect success
2026-06-22T19:33:25.495Z    📤  deploy_agent(resumed) submitted: mock-5a3511e10d4c
2026-06-22T19:33:25.495Z  
2026-06-22T19:33:25.495Z  ## 13. transfer_ownership(new_owner) — owner-only
2026-06-22T19:33:25.495Z    📤  transfer_ownership(01dddddd…) submitted: mock-f38331ff78b4
2026-06-22T19:33:25.495Z  
2026-06-22T19:33:25.495Z  ## 14. deploy_agent under old owner → expect revert (post transfer)
2026-06-22T19:33:25.495Z    📤  deploy_agent(post_transfer) submitted: mock-f255850e1225
2026-06-22T19:33:25.495Z  
2026-06-22T19:33:25.495Z  ## 14b. set_paused(true) → deploy_agent reverts (negative control)
2026-06-22T19:33:25.495Z    📤  set_paused(true) [post-transfer] submitted: mock-958012a96b80
2026-06-22T19:33:25.495Z    ✅  deploy_agent(under_pause_post_transfer) reverted as expected: User: 0 reverted: Error::Paused
2026-06-22T19:33:25.495Z    📤  set_paused(false) [resume again] submitted: mock-dcc3429acd48
2026-06-22T19:33:25.495Z  
2026-06-22T19:33:25.495Z  ## 15. cep18_burn(amount=100) — holder-only, emits Burn
2026-06-22T19:33:25.495Z    📤  cep18_burn(100) submitted: mock-65869944756a
2026-06-22T19:33:25.495Z  
2026-06-22T19:33:25.495Z  ## 16. cep78_mint + cep78_burn — owner/operator, emits Burn
2026-06-22T19:33:25.495Z    📤  cep78_mint(recipient) submitted: mock-7a0851df6575
2026-06-22T19:33:25.495Z    📤  cep78_burn(token_id=1) submitted: mock-4b51518980e2
2026-06-22T19:33:25.495Z  
2026-06-22T19:33:25.495Z  ## 17. escrow_set_treasury — backend-only
2026-06-22T19:33:25.495Z    📤  set_treasury(01111111…) submitted: mock-7c1f2f55948f
2026-06-22T19:33:25.495Z  
2026-06-22T19:33:25.495Z  ## 18. on-chain event verification (CSPR.cloud events feed)
2026-06-22T19:33:25.495Z    📡  Emitted events (mock): {"Attest":2,"RevokeAttestation":1,"Burn":2}
2026-06-22T19:33:25.495Z  
2026-06-22T19:33:25.495Z  Run finished.
2026-06-22T19:33:39.545Z  # CasperOPs Testnet End-to-End Run (DRYRUN)
2026-06-22T19:33:39.546Z  Deployer: `010101010101010101010101010101010101010101010101010101010101010101` (ed25519 (mock))
2026-06-22T19:33:39.546Z  Mode: in-memory mock (no live RPC, no CSPR.cloud)
2026-06-22T19:33:39.546Z  Factory:   hash-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
2026-06-22T19:33:39.546Z  Reputation: hash-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
2026-06-22T19:33:39.546Z  Escrow:    hash-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
2026-06-22T19:33:39.546Z  Compliance: hash-dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
2026-06-22T19:33:39.546Z  Cep18:     hash-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
2026-06-22T19:33:39.546Z  Cep78:     hash-ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
2026-06-22T19:33:39.546Z  
2026-06-22T19:33:39.546Z  ## 1. register_agent (AgentFactory::deploy_agent)
2026-06-22T19:33:39.547Z    📤  register_agent(agent-1782156819546) submitted: mock-4628a37b6282
2026-06-22T19:33:39.547Z  
2026-06-22T19:33:39.547Z  ## 2. attest_agent (Reputation)
2026-06-22T19:33:39.547Z    📤  attest_agent(agent-1782156819546,85) submitted: mock-fade1d54e72c
2026-06-22T19:33:39.547Z  
2026-06-22T19:33:39.547Z  ## 3. get_reputation (view)
2026-06-22T19:33:39.547Z    📊  "mock"
2026-06-22T19:33:39.548Z  
2026-06-22T19:33:39.548Z  ## 4. escrow_deposit
2026-06-22T19:33:39.548Z    📤  escrow_deposit(agent-1782156819546,1.0 CSPR) submitted: mock-c8502bdd49bf
2026-06-22T19:33:39.548Z  
2026-06-22T19:33:39.548Z  ## 5. escrow_payout
2026-06-22T19:33:39.548Z    📤  escrow_payout(agent-1782156819546) submitted: mock-7aadb1a4770b
2026-06-22T19:33:39.548Z  
2026-06-22T19:33:39.548Z  ## 6. Final state check (CSPR.cloud)
2026-06-22T19:33:40.549Z    ⚠️  CSPR.cloud check failed: This operation was aborted
2026-06-22T19:33:40.549Z  
2026-06-22T19:33:40.549Z  ## 7. compliance_attest (Compliance::attest_agent, emits Attest)
2026-06-22T19:33:40.550Z    📤  compliance_attest(verified=true) submitted: mock-48a95b2ba80f
2026-06-22T19:33:40.550Z  
2026-06-22T19:33:40.550Z  ## 8. compliance_revoke (verified: true → false, emits RevokeAttestation)
2026-06-22T19:33:40.550Z    📤  compliance_revoke(verified=false) submitted: mock-e749c1ed9ce3
2026-06-22T19:33:40.550Z  
2026-06-22T19:33:40.550Z  ## 9. set_paused(true) — AgentFactory, owner-only
2026-06-22T19:33:40.550Z    📤  set_paused(true) submitted: mock-a24c4a14c79c
2026-06-22T19:33:40.550Z  
2026-06-22T19:33:40.550Z  ## 10. deploy_agent under pause → expect revert
2026-06-22T19:33:40.550Z    ✅  deploy_agent(under_pause) reverted as expected: User: 0 reverted: Error::Paused
2026-06-22T19:33:40.550Z  
2026-06-22T19:33:40.550Z  ## 11. set_paused(false) — resume
2026-06-22T19:33:40.550Z    📤  set_paused(false) submitted: mock-3ec5f50186a2
2026-06-22T19:33:40.550Z  
2026-06-22T19:33:40.550Z  ## 12. deploy_agent → expect success
2026-06-22T19:33:40.550Z    📤  deploy_agent(resumed) submitted: mock-af390fd180dd
2026-06-22T19:33:40.550Z  
2026-06-22T19:33:40.550Z  ## 13. transfer_ownership(new_owner) — owner-only
2026-06-22T19:33:40.550Z    📤  transfer_ownership(01dddddd…) submitted: mock-5a8539e41b88
2026-06-22T19:33:40.550Z  
2026-06-22T19:33:40.550Z  ## 14. deploy_agent under old owner → expect revert (post transfer)
2026-06-22T19:33:40.550Z    📤  deploy_agent(post_transfer) submitted: mock-815635cc0bcb
2026-06-22T19:33:40.550Z  
2026-06-22T19:33:40.550Z  ## 14b. set_paused(true) → deploy_agent reverts (negative control)
2026-06-22T19:33:40.550Z    📤  set_paused(true) [post-transfer] submitted: mock-f36dcd94b5cc
2026-06-22T19:33:40.550Z    ✅  deploy_agent(under_pause_post_transfer) reverted as expected: User: 0 reverted: Error::Paused
2026-06-22T19:33:40.550Z    📤  set_paused(false) [resume again] submitted: mock-a0cfe1a15022
2026-06-22T19:33:40.550Z  
2026-06-22T19:33:40.550Z  ## 15. cep18_burn(amount=100) — holder-only, emits Burn
2026-06-22T19:33:40.550Z    📤  cep18_burn(100) submitted: mock-40671655f671
2026-06-22T19:33:40.550Z  
2026-06-22T19:33:40.550Z  ## 16. cep78_mint + cep78_burn — owner/operator, emits Burn
2026-06-22T19:33:40.550Z    📤  cep78_mint(recipient) submitted: mock-171ae50ed7bf
2026-06-22T19:33:40.550Z    📤  cep78_burn(token_id=1) submitted: mock-2bd74ed84927
2026-06-22T19:33:40.550Z  
2026-06-22T19:33:40.550Z  ## 17. escrow_set_treasury — backend-only
2026-06-22T19:33:40.550Z    📤  set_treasury(01111111…) submitted: mock-f72e4c3b1cea
2026-06-22T19:33:40.550Z  
2026-06-22T19:33:40.550Z  ## 18. on-chain event verification (CSPR.cloud events feed)
2026-06-22T19:33:40.550Z    📡  Emitted events (mock): {"Attest":2,"RevokeAttestation":1,"Burn":2}
2026-06-22T19:33:40.550Z  
2026-06-22T19:33:40.550Z  Run finished.
2026-06-22T19:33:52.877Z  # CasperOPs Testnet End-to-End Run (DRYRUN)
2026-06-22T19:33:52.877Z  Deployer: `010101010101010101010101010101010101010101010101010101010101010101` (ed25519 (mock))
2026-06-22T19:33:52.877Z  Mode: in-memory mock (no live RPC, no CSPR.cloud)
2026-06-22T19:33:52.877Z  Factory:   hash-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
2026-06-22T19:33:52.877Z  Reputation: hash-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
2026-06-22T19:33:52.877Z  Escrow:    hash-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
2026-06-22T19:33:52.877Z  Compliance: hash-dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
2026-06-22T19:33:52.877Z  Cep18:     hash-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
2026-06-22T19:33:52.877Z  Cep78:     hash-ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
2026-06-22T19:33:52.878Z  
2026-06-22T19:33:52.878Z  ## 1. register_agent (AgentFactory::deploy_agent)
2026-06-22T19:33:52.878Z    📤  register_agent(agent-1782156832878) submitted: mock-0c493e5db9a6
2026-06-22T19:33:52.878Z  
2026-06-22T19:33:52.878Z  ## 2. attest_agent (Reputation)
2026-06-22T19:33:52.878Z    📤  attest_agent(agent-1782156832878,85) submitted: mock-a9bc9034d9a1
2026-06-22T19:33:52.878Z  
2026-06-22T19:33:52.878Z  ## 3. get_reputation (view)
2026-06-22T19:33:52.878Z    📊  "mock"
2026-06-22T19:33:52.878Z  
2026-06-22T19:33:52.878Z  ## 4. escrow_deposit
2026-06-22T19:33:52.878Z    📤  escrow_deposit(agent-1782156832878,1.0 CSPR) submitted: mock-2fc9b5136d54
2026-06-22T19:33:52.878Z  
2026-06-22T19:33:52.878Z  ## 5. escrow_payout
2026-06-22T19:33:52.878Z    📤  escrow_payout(agent-1782156832878) submitted: mock-67406cbc7a25
2026-06-22T19:33:52.878Z  
2026-06-22T19:33:52.878Z  ## 6. Final state check (CSPR.cloud)
2026-06-22T19:33:53.879Z    ⚠️  CSPR.cloud check failed: This operation was aborted
2026-06-22T19:33:53.879Z  
2026-06-22T19:33:53.879Z  ## 7. compliance_attest (Compliance::attest_agent, emits Attest)
2026-06-22T19:33:53.879Z    📤  compliance_attest(verified=true) submitted: mock-c7a4d0dfa3da
2026-06-22T19:33:53.879Z  
2026-06-22T19:33:53.879Z  ## 8. compliance_revoke (verified: true → false, emits RevokeAttestation)
2026-06-22T19:33:53.879Z    📤  compliance_revoke(verified=false) submitted: mock-d9f070331768
2026-06-22T19:33:53.879Z  
2026-06-22T19:33:53.879Z  ## 9. set_paused(true) — AgentFactory, owner-only
2026-06-22T19:33:53.879Z    📤  set_paused(true) submitted: mock-71d0164736fb
2026-06-22T19:33:53.879Z  
2026-06-22T19:33:53.879Z  ## 10. deploy_agent under pause → expect revert
2026-06-22T19:33:53.880Z    ✅  deploy_agent(under_pause) reverted as expected: User: 0 reverted: Error::Paused
2026-06-22T19:33:53.880Z  
2026-06-22T19:33:53.880Z  ## 11. set_paused(false) — resume
2026-06-22T19:33:53.880Z    📤  set_paused(false) submitted: mock-6a0eb39be27a
2026-06-22T19:33:53.880Z  
2026-06-22T19:33:53.880Z  ## 12. deploy_agent → expect success
2026-06-22T19:33:53.880Z    📤  deploy_agent(resumed) submitted: mock-455558960f6d
2026-06-22T19:33:53.880Z  
2026-06-22T19:33:53.880Z  ## 13. transfer_ownership(new_owner) — owner-only
2026-06-22T19:33:53.880Z    📤  transfer_ownership(01dddddd…) submitted: mock-7d4a50b40883
2026-06-22T19:33:53.880Z  
2026-06-22T19:33:53.880Z  ## 14. deploy_agent under old owner → expect revert (post transfer)
2026-06-22T19:33:53.880Z    📤  deploy_agent(post_transfer) submitted: mock-04d8d05d2808
2026-06-22T19:33:53.880Z  
2026-06-22T19:33:53.880Z  ## 14b. set_paused(true) → deploy_agent reverts (negative control)
2026-06-22T19:33:53.880Z    📤  set_paused(true) [post-transfer] submitted: mock-223f60c521cf
2026-06-22T19:33:53.880Z    ✅  deploy_agent(under_pause_post_transfer) reverted as expected: User: 0 reverted: Error::Paused
2026-06-22T19:33:53.880Z    📤  set_paused(false) [resume again] submitted: mock-7716daf39930
2026-06-22T19:33:53.880Z  
2026-06-22T19:33:53.880Z  ## 15. cep18_burn(amount=100) — holder-only, emits Burn
2026-06-22T19:33:53.880Z    📤  cep18_burn(100) submitted: mock-a2f7db9c3eea
2026-06-22T19:33:53.880Z  
2026-06-22T19:33:53.880Z  ## 16. cep78_mint + cep78_burn — owner/operator, emits Burn
2026-06-22T19:33:53.880Z    📤  cep78_mint(recipient) submitted: mock-e873f876d9c2
2026-06-22T19:33:53.880Z    📤  cep78_burn(token_id=1) submitted: mock-f759d55bc5a2
2026-06-22T19:33:53.880Z  
2026-06-22T19:33:53.880Z  ## 17. escrow_set_treasury — backend-only
2026-06-22T19:33:53.880Z    📤  set_treasury(01111111…) submitted: mock-9b704ccb150f
2026-06-22T19:33:53.880Z  
2026-06-22T19:33:53.880Z  ## 18. on-chain event verification (CSPR.cloud events feed)
2026-06-22T19:33:53.880Z    📡  Emitted events (mock): {"Attest":2,"RevokeAttestation":1,"Burn":2}
2026-06-22T19:33:53.880Z  
2026-06-22T19:33:53.880Z  Run finished.
2026-06-22T19:34:23.999Z  # CasperOPs Testnet End-to-End Run (DRYRUN)
2026-06-22T19:34:23.999Z  Deployer: `010101010101010101010101010101010101010101010101010101010101010101` (ed25519 (mock))
2026-06-22T19:34:24.000Z  Mode: in-memory mock (no live RPC, no CSPR.cloud)
2026-06-22T19:34:24.000Z  Factory:   hash-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
2026-06-22T19:34:24.000Z  Reputation: hash-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
2026-06-22T19:34:24.000Z  Escrow:    hash-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
2026-06-22T19:34:24.000Z  Compliance: hash-dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
2026-06-22T19:34:24.000Z  Cep18:     hash-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
2026-06-22T19:34:24.000Z  Cep78:     hash-ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
2026-06-22T19:34:24.000Z  
2026-06-22T19:34:24.000Z  ## 1. register_agent (AgentFactory::deploy_agent)
2026-06-22T19:34:24.000Z    📤  register_agent(agent-1782156864000) submitted: mock-6826a7621d04
2026-06-22T19:34:24.000Z  
2026-06-22T19:34:24.000Z  ## 2. attest_agent (Reputation)
2026-06-22T19:34:24.000Z    📤  attest_agent(agent-1782156864000,85) submitted: mock-bcffce152b1a
2026-06-22T19:34:24.000Z  
2026-06-22T19:34:24.000Z  ## 3. get_reputation (view)
2026-06-22T19:34:24.000Z    📊  "mock"
2026-06-22T19:34:24.000Z  
2026-06-22T19:34:24.000Z  ## 4. escrow_deposit
2026-06-22T19:34:24.000Z    📤  escrow_deposit(agent-1782156864000,1.0 CSPR) submitted: mock-664001e93212
2026-06-22T19:34:24.000Z  
2026-06-22T19:34:24.000Z  ## 5. escrow_payout
2026-06-22T19:34:24.000Z    📤  escrow_payout(agent-1782156864000) submitted: mock-4f15a91c55bf
2026-06-22T19:34:24.000Z  
2026-06-22T19:34:24.000Z  ## 6. Final state check (CSPR.cloud)
2026-06-22T19:34:25.001Z    ⚠️  CSPR.cloud check failed: This operation was aborted
2026-06-22T19:34:25.001Z  
2026-06-22T19:34:25.001Z  ## 7. compliance_attest (Compliance::attest_agent, emits Attest)
2026-06-22T19:34:25.001Z    📤  compliance_attest(verified=true) submitted: mock-64738708eca9
2026-06-22T19:34:25.001Z  
2026-06-22T19:34:25.001Z  ## 8. compliance_revoke (verified: true → false, emits RevokeAttestation)
2026-06-22T19:34:25.001Z    📤  compliance_revoke(verified=false) submitted: mock-9e8cd51162ca
2026-06-22T19:34:25.001Z  
2026-06-22T19:34:25.001Z  ## 9. set_paused(true) — AgentFactory, owner-only
2026-06-22T19:34:25.001Z    📤  set_paused(true) submitted: mock-578e26432b59
2026-06-22T19:34:25.001Z  
2026-06-22T19:34:25.001Z  ## 10. deploy_agent under pause → expect revert
2026-06-22T19:34:25.001Z    ✅  deploy_agent(under_pause) reverted as expected: User: 0 reverted: Error::Paused
2026-06-22T19:34:25.001Z  
2026-06-22T19:34:25.001Z  ## 11. set_paused(false) — resume
2026-06-22T19:34:25.001Z    📤  set_paused(false) submitted: mock-d643f1438a66
2026-06-22T19:34:25.001Z  
2026-06-22T19:34:25.001Z  ## 12. deploy_agent → expect success
2026-06-22T19:34:25.001Z    📤  deploy_agent(resumed) submitted: mock-312948652a7f
2026-06-22T19:34:25.001Z  
2026-06-22T19:34:25.001Z  ## 13. transfer_ownership(new_owner) — owner-only
2026-06-22T19:34:25.001Z    📤  transfer_ownership(01dddddd…) submitted: mock-3c7200431aba
2026-06-22T19:34:25.001Z  
2026-06-22T19:34:25.001Z  ## 14. deploy_agent under old owner → expect revert (post transfer)
2026-06-22T19:34:25.001Z    📤  deploy_agent(post_transfer) submitted: mock-e4993873271b
2026-06-22T19:34:25.001Z  
2026-06-22T19:34:25.001Z  ## 14b. set_paused(true) → deploy_agent reverts (negative control)
2026-06-22T19:34:25.001Z    📤  set_paused(true) [post-transfer] submitted: mock-98c59e223d9b
2026-06-22T19:34:25.001Z    ✅  deploy_agent(under_pause_post_transfer) reverted as expected: User: 0 reverted: Error::Paused
2026-06-22T19:34:25.001Z    📤  set_paused(false) [resume again] submitted: mock-9c948dd0508b
2026-06-22T19:34:25.001Z  
2026-06-22T19:34:25.001Z  ## 15. cep18_burn(amount=100) — holder-only, emits Burn
2026-06-22T19:34:25.001Z    📤  cep18_burn(100) submitted: mock-5d1b04cb25a6
2026-06-22T19:34:25.001Z  
2026-06-22T19:34:25.001Z  ## 16. cep78_mint + cep78_burn — owner/operator, emits Burn
2026-06-22T19:34:25.001Z    📤  cep78_mint(recipient) submitted: mock-5065365fc6bf
2026-06-22T19:34:25.001Z    📤  cep78_burn(token_id=1) submitted: mock-5c131ef091d2
2026-06-22T19:34:25.001Z  
2026-06-22T19:34:25.001Z  ## 17. escrow_set_treasury — backend-only
2026-06-22T19:34:25.001Z    📤  set_treasury(01111111…) submitted: mock-77175118d541
2026-06-22T19:34:25.001Z  
2026-06-22T19:34:25.001Z  ## 18. on-chain event verification (CSPR.cloud events feed)
2026-06-22T19:34:25.001Z    📡  Emitted events (mock): {"Attest":2,"RevokeAttestation":1,"Burn":2}
2026-06-22T19:34:25.001Z  
2026-06-22T19:34:25.001Z  Run finished.
2026-06-22T19:34:37.306Z  # CasperOPs Testnet End-to-End Run (DRYRUN)
2026-06-22T19:34:37.306Z  Deployer: `010101010101010101010101010101010101010101010101010101010101010101` (ed25519 (mock))
2026-06-22T19:34:37.306Z  Mode: in-memory mock (no live RPC, no CSPR.cloud)
2026-06-22T19:34:37.306Z  Factory:   hash-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
2026-06-22T19:34:37.306Z  Reputation: hash-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
2026-06-22T19:34:37.306Z  Escrow:    hash-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
2026-06-22T19:34:37.306Z  Compliance: hash-dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
2026-06-22T19:34:37.306Z  Cep18:     hash-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
2026-06-22T19:34:37.306Z  Cep78:     hash-ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
2026-06-22T19:34:37.306Z  
2026-06-22T19:34:37.306Z  ## 1. register_agent (AgentFactory::deploy_agent)
2026-06-22T19:34:37.307Z    📤  register_agent(agent-1782156877306) submitted: mock-704c0de5ca88
2026-06-22T19:34:37.307Z  
2026-06-22T19:34:37.307Z  ## 2. attest_agent (Reputation)
2026-06-22T19:34:37.307Z    📤  attest_agent(agent-1782156877306,85) submitted: mock-04f6b9a3c191
2026-06-22T19:34:37.307Z  
2026-06-22T19:34:37.307Z  ## 3. get_reputation (view)
2026-06-22T19:34:37.307Z    📊  "mock"
2026-06-22T19:34:37.307Z  
2026-06-22T19:34:37.307Z  ## 4. escrow_deposit
2026-06-22T19:34:37.307Z    📤  escrow_deposit(agent-1782156877306,1.0 CSPR) submitted: mock-3a768a3ba76c
2026-06-22T19:34:37.307Z  
2026-06-22T19:34:37.307Z  ## 5. escrow_payout
2026-06-22T19:34:37.307Z    📤  escrow_payout(agent-1782156877306) submitted: mock-877da62c069d
2026-06-22T19:34:37.307Z  
2026-06-22T19:34:37.307Z  ## 6. Final state check (CSPR.cloud)
2026-06-22T19:34:38.308Z    ⚠️  CSPR.cloud check failed: This operation was aborted
2026-06-22T19:34:38.308Z  
2026-06-22T19:34:38.308Z  ## 7. compliance_attest (Compliance::attest_agent, emits Attest)
2026-06-22T19:34:38.308Z    📤  compliance_attest(verified=true) submitted: mock-c9a9c304cd5d
2026-06-22T19:34:38.308Z  
2026-06-22T19:34:38.308Z  ## 8. compliance_revoke (verified: true → false, emits RevokeAttestation)
2026-06-22T19:34:38.308Z    📤  compliance_revoke(verified=false) submitted: mock-9f6f175a9eae
2026-06-22T19:34:38.308Z  
2026-06-22T19:34:38.308Z  ## 9. set_paused(true) — AgentFactory, owner-only
2026-06-22T19:34:38.308Z    📤  set_paused(true) submitted: mock-4a2e2514efab
2026-06-22T19:34:38.308Z  
2026-06-22T19:34:38.308Z  ## 10. deploy_agent under pause → expect revert
2026-06-22T19:34:38.308Z    ✅  deploy_agent(under_pause) reverted as expected: User: 0 reverted: Error::Paused
2026-06-22T19:34:38.308Z  
2026-06-22T19:34:38.308Z  ## 11. set_paused(false) — resume
2026-06-22T19:34:38.308Z    📤  set_paused(false) submitted: mock-930ab7d0214b
2026-06-22T19:34:38.308Z  
2026-06-22T19:34:38.308Z  ## 12. deploy_agent → expect success
2026-06-22T19:34:38.308Z    📤  deploy_agent(resumed) submitted: mock-128a73b45b76
2026-06-22T19:34:38.308Z  
2026-06-22T19:34:38.308Z  ## 13. transfer_ownership(new_owner) — owner-only
2026-06-22T19:34:38.308Z    📤  transfer_ownership(01dddddd…) submitted: mock-5267b7a1cf66
2026-06-22T19:34:38.308Z  
2026-06-22T19:34:38.308Z  ## 14. deploy_agent under old owner → expect revert (post transfer)
2026-06-22T19:34:38.308Z    📤  deploy_agent(post_transfer) submitted: mock-290e0dad5d53
2026-06-22T19:34:38.308Z  
2026-06-22T19:34:38.308Z  ## 14b. set_paused(true) → deploy_agent reverts (negative control)
2026-06-22T19:34:38.308Z    📤  set_paused(true) [post-transfer] submitted: mock-ef3f3e2f5175
2026-06-22T19:34:38.308Z    ✅  deploy_agent(under_pause_post_transfer) reverted as expected: User: 0 reverted: Error::Paused
2026-06-22T19:34:38.308Z    📤  set_paused(false) [resume again] submitted: mock-a2ecbb8786bd
2026-06-22T19:34:38.308Z  
2026-06-22T19:34:38.308Z  ## 15. cep18_burn(amount=100) — holder-only, emits Burn
2026-06-22T19:34:38.308Z    📤  cep18_burn(100) submitted: mock-68bc19062df2
2026-06-22T19:34:38.308Z  
2026-06-22T19:34:38.308Z  ## 16. cep78_mint + cep78_burn — owner/operator, emits Burn
2026-06-22T19:34:38.308Z    📤  cep78_mint(recipient) submitted: mock-dd734532c875
2026-06-22T19:34:38.308Z    📤  cep78_burn(token_id=1) submitted: mock-b52afd7f56e8
2026-06-22T19:34:38.308Z  
2026-06-22T19:34:38.308Z  ## 17. escrow_set_treasury — backend-only
2026-06-22T19:34:38.308Z    📤  set_treasury(01111111…) submitted: mock-c5553e184834
2026-06-22T19:34:38.308Z  
2026-06-22T19:34:38.308Z  ## 18. on-chain event verification (CSPR.cloud events feed)
2026-06-22T19:34:38.308Z    📡  Emitted events (mock): {"Attest":2,"RevokeAttestation":1,"Burn":2}
2026-06-22T19:34:38.308Z  
2026-06-22T19:34:38.308Z  Run finished.
2026-06-22T19:34:50.129Z  # CasperOPs Testnet End-to-End Run (DRYRUN)
2026-06-22T19:34:50.130Z  Deployer: `010101010101010101010101010101010101010101010101010101010101010101` (ed25519 (mock))
2026-06-22T19:34:50.130Z  Mode: in-memory mock (no live RPC, no CSPR.cloud)
2026-06-22T19:34:50.130Z  Factory:   hash-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
2026-06-22T19:34:50.130Z  Reputation: hash-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
2026-06-22T19:34:50.130Z  Escrow:    hash-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
2026-06-22T19:34:50.130Z  Compliance: hash-dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
2026-06-22T19:34:50.130Z  Cep18:     hash-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
2026-06-22T19:34:50.130Z  Cep78:     hash-ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
2026-06-22T19:34:50.130Z  
2026-06-22T19:34:50.130Z  ## 1. register_agent (AgentFactory::deploy_agent)
2026-06-22T19:34:50.130Z    📤  register_agent(agent-1782156890130) submitted: mock-a3c1f7241556
2026-06-22T19:34:50.130Z  
2026-06-22T19:34:50.130Z  ## 2. attest_agent (Reputation)
2026-06-22T19:34:50.130Z    📤  attest_agent(agent-1782156890130,85) submitted: mock-f54ed8ce4adc
2026-06-22T19:34:50.130Z  
2026-06-22T19:34:50.130Z  ## 3. get_reputation (view)
2026-06-22T19:34:50.130Z    📊  "mock"
2026-06-22T19:34:50.130Z  
2026-06-22T19:34:50.130Z  ## 4. escrow_deposit
2026-06-22T19:34:50.130Z    📤  escrow_deposit(agent-1782156890130,1.0 CSPR) submitted: mock-5c4b061b7b86
2026-06-22T19:34:50.130Z  
2026-06-22T19:34:50.130Z  ## 5. escrow_payout
2026-06-22T19:34:50.130Z    📤  escrow_payout(agent-1782156890130) submitted: mock-6ff2f1ee5de0
2026-06-22T19:34:50.130Z  
2026-06-22T19:34:50.130Z  ## 6. Final state check (CSPR.cloud)
2026-06-22T19:34:51.131Z    ⚠️  CSPR.cloud check failed: This operation was aborted
2026-06-22T19:34:51.131Z  
2026-06-22T19:34:51.131Z  ## 7. compliance_attest (Compliance::attest_agent, emits Attest)
2026-06-22T19:34:51.132Z    📤  compliance_attest(verified=true) submitted: mock-f455583f68cc
2026-06-22T19:34:51.132Z  
2026-06-22T19:34:51.132Z  ## 8. compliance_revoke (verified: true → false, emits RevokeAttestation)
2026-06-22T19:34:51.132Z    📤  compliance_revoke(verified=false) submitted: mock-bf80f576b49a
2026-06-22T19:34:51.132Z  
2026-06-22T19:34:51.132Z  ## 9. set_paused(true) — AgentFactory, owner-only
2026-06-22T19:34:51.132Z    📤  set_paused(true) submitted: mock-2930ad43fa2d
2026-06-22T19:34:51.132Z  
2026-06-22T19:34:51.132Z  ## 10. deploy_agent under pause → expect revert
2026-06-22T19:34:51.132Z    ✅  deploy_agent(under_pause) reverted as expected: User: 0 reverted: Error::Paused
2026-06-22T19:34:51.132Z  
2026-06-22T19:34:51.132Z  ## 11. set_paused(false) — resume
2026-06-22T19:34:51.132Z    📤  set_paused(false) submitted: mock-f5b6a1483687
2026-06-22T19:34:51.132Z  
2026-06-22T19:34:51.132Z  ## 12. deploy_agent → expect success
2026-06-22T19:34:51.132Z    📤  deploy_agent(resumed) submitted: mock-aa3d1c3bbe1c
2026-06-22T19:34:51.132Z  
2026-06-22T19:34:51.132Z  ## 13. transfer_ownership(new_owner) — owner-only
2026-06-22T19:34:51.132Z    📤  transfer_ownership(01dddddd…) submitted: mock-d7d724ba62f0
2026-06-22T19:34:51.132Z  
2026-06-22T19:34:51.132Z  ## 14. deploy_agent under old owner → expect revert (post transfer)
2026-06-22T19:34:51.132Z    📤  deploy_agent(post_transfer) submitted: mock-35ea5a50a36f
2026-06-22T19:34:51.132Z  
2026-06-22T19:34:51.132Z  ## 14b. set_paused(true) → deploy_agent reverts (negative control)
2026-06-22T19:34:51.132Z    📤  set_paused(true) [post-transfer] submitted: mock-9a73dc88c10f
2026-06-22T19:34:51.132Z    ✅  deploy_agent(under_pause_post_transfer) reverted as expected: User: 0 reverted: Error::Paused
2026-06-22T19:34:51.132Z    📤  set_paused(false) [resume again] submitted: mock-96f10924b0d5
2026-06-22T19:34:51.132Z  
2026-06-22T19:34:51.132Z  ## 15. cep18_burn(amount=100) — holder-only, emits Burn
2026-06-22T19:34:51.132Z    📤  cep18_burn(100) submitted: mock-f8ba200859f2
2026-06-22T19:34:51.132Z  
2026-06-22T19:34:51.132Z  ## 16. cep78_mint + cep78_burn — owner/operator, emits Burn
2026-06-22T19:34:51.132Z    📤  cep78_mint(recipient) submitted: mock-d63653f7ddec
2026-06-22T19:34:51.132Z    📤  cep78_burn(token_id=1) submitted: mock-ad633f98d23a
2026-06-22T19:34:51.132Z  
2026-06-22T19:34:51.132Z  ## 17. escrow_set_treasury — backend-only
2026-06-22T19:34:51.132Z    📤  set_treasury(01111111…) submitted: mock-460b68ddc2b0
2026-06-22T19:34:51.132Z  
2026-06-22T19:34:51.132Z  ## 18. on-chain event verification (CSPR.cloud events feed)
2026-06-22T19:34:51.132Z    📡  Emitted events (mock): {"Attest":2,"RevokeAttestation":1,"Burn":2}
2026-06-22T19:34:51.132Z  
2026-06-22T19:34:51.132Z  Run finished.
2026-06-22T19:35:02.364Z  # CasperOPs Testnet End-to-End Run (DRYRUN)
2026-06-22T19:35:02.365Z  Deployer: `010101010101010101010101010101010101010101010101010101010101010101` (ed25519 (mock))
2026-06-22T19:35:02.365Z  Mode: in-memory mock (no live RPC, no CSPR.cloud)
2026-06-22T19:35:02.365Z  Factory:   hash-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
2026-06-22T19:35:02.365Z  Reputation: hash-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
2026-06-22T19:35:02.365Z  Escrow:    hash-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
2026-06-22T19:35:02.365Z  Compliance: hash-dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
2026-06-22T19:35:02.366Z  Cep18:     hash-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
2026-06-22T19:35:02.366Z  Cep78:     hash-ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
2026-06-22T19:35:02.366Z  
2026-06-22T19:35:02.366Z  ## 1. register_agent (AgentFactory::deploy_agent)
2026-06-22T19:35:02.366Z    📤  register_agent(agent-1782156902366) submitted: mock-9a1bfb20a6f9
2026-06-22T19:35:02.366Z  
2026-06-22T19:35:02.366Z  ## 2. attest_agent (Reputation)
2026-06-22T19:35:02.367Z    📤  attest_agent(agent-1782156902366,85) submitted: mock-c5681f668bc8
2026-06-22T19:35:02.367Z  
2026-06-22T19:35:02.367Z  ## 3. get_reputation (view)
2026-06-22T19:35:02.367Z    📊  "mock"
2026-06-22T19:35:02.367Z  
2026-06-22T19:35:02.367Z  ## 4. escrow_deposit
2026-06-22T19:35:02.367Z    📤  escrow_deposit(agent-1782156902366,1.0 CSPR) submitted: mock-42f32eef9220
2026-06-22T19:35:02.367Z  
2026-06-22T19:35:02.367Z  ## 5. escrow_payout
2026-06-22T19:35:02.367Z    📤  escrow_payout(agent-1782156902366) submitted: mock-52042a6751bb
2026-06-22T19:35:02.367Z  
2026-06-22T19:35:02.367Z  ## 6. Final state check (CSPR.cloud)
2026-06-22T19:35:03.370Z    ⚠️  CSPR.cloud check failed: This operation was aborted
2026-06-22T19:35:03.370Z  
2026-06-22T19:35:03.370Z  ## 7. compliance_attest (Compliance::attest_agent, emits Attest)
2026-06-22T19:35:03.370Z    📤  compliance_attest(verified=true) submitted: mock-306dc8354621
2026-06-22T19:35:03.370Z  
2026-06-22T19:35:03.370Z  ## 8. compliance_revoke (verified: true → false, emits RevokeAttestation)
2026-06-22T19:35:03.370Z    📤  compliance_revoke(verified=false) submitted: mock-e55cd9f1da15
2026-06-22T19:35:03.370Z  
2026-06-22T19:35:03.370Z  ## 9. set_paused(true) — AgentFactory, owner-only
2026-06-22T19:35:03.370Z    📤  set_paused(true) submitted: mock-a1776208f2d4
2026-06-22T19:35:03.370Z  
2026-06-22T19:35:03.370Z  ## 10. deploy_agent under pause → expect revert
2026-06-22T19:35:03.370Z    ✅  deploy_agent(under_pause) reverted as expected: User: 0 reverted: Error::Paused
2026-06-22T19:35:03.370Z  
2026-06-22T19:35:03.370Z  ## 11. set_paused(false) — resume
2026-06-22T19:35:03.370Z    📤  set_paused(false) submitted: mock-d0691e49a537
2026-06-22T19:35:03.370Z  
2026-06-22T19:35:03.370Z  ## 12. deploy_agent → expect success
2026-06-22T19:35:03.370Z    📤  deploy_agent(resumed) submitted: mock-172523b1997e
2026-06-22T19:35:03.370Z  
2026-06-22T19:35:03.370Z  ## 13. transfer_ownership(new_owner) — owner-only
2026-06-22T19:35:03.370Z    📤  transfer_ownership(01dddddd…) submitted: mock-62d75438391a
2026-06-22T19:35:03.370Z  
2026-06-22T19:35:03.370Z  ## 14. deploy_agent under old owner → expect revert (post transfer)
2026-06-22T19:35:03.370Z    📤  deploy_agent(post_transfer) submitted: mock-b9de032b4ae7
2026-06-22T19:35:03.370Z  
2026-06-22T19:35:03.370Z  ## 14b. set_paused(true) → deploy_agent reverts (negative control)
2026-06-22T19:35:03.370Z    📤  set_paused(true) [post-transfer] submitted: mock-a2242a914da0
2026-06-22T19:35:03.370Z    ✅  deploy_agent(under_pause_post_transfer) reverted as expected: User: 0 reverted: Error::Paused
2026-06-22T19:35:03.370Z    📤  set_paused(false) [resume again] submitted: mock-07142249641b
2026-06-22T19:35:03.370Z  
2026-06-22T19:35:03.371Z  ## 15. cep18_burn(amount=100) — holder-only, emits Burn
2026-06-22T19:35:03.371Z    📤  cep18_burn(100) submitted: mock-8945aba72473
2026-06-22T19:35:03.371Z  
2026-06-22T19:35:03.371Z  ## 16. cep78_mint + cep78_burn — owner/operator, emits Burn
2026-06-22T19:35:03.371Z    📤  cep78_mint(recipient) submitted: mock-afc9bf43cfe6
2026-06-22T19:35:03.371Z    📤  cep78_burn(token_id=1) submitted: mock-98072adcfdfa
2026-06-22T19:35:03.371Z  
2026-06-22T19:35:03.371Z  ## 17. escrow_set_treasury — backend-only
2026-06-22T19:35:03.371Z    📤  set_treasury(01111111…) submitted: mock-f2d362251c59
2026-06-22T19:35:03.371Z  
2026-06-22T19:35:03.371Z  ## 18. on-chain event verification (CSPR.cloud events feed)
2026-06-22T19:35:03.371Z    📡  Emitted events (mock): {"Attest":2,"RevokeAttestation":1,"Burn":2}
2026-06-22T19:35:03.371Z  
2026-06-22T19:35:03.371Z  Run finished.
2026-06-22T19:35:37.315Z  # CasperOPs Testnet End-to-End Run (DRYRUN)
2026-06-22T19:35:37.315Z  Deployer: `010101010101010101010101010101010101010101010101010101010101010101` (ed25519 (mock))
2026-06-22T19:35:37.315Z  Mode: in-memory mock (no live RPC, no CSPR.cloud)
2026-06-22T19:35:37.315Z  Factory:   hash-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
2026-06-22T19:35:37.315Z  Reputation: hash-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
2026-06-22T19:35:37.315Z  Escrow:    hash-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
2026-06-22T19:35:37.315Z  Compliance: hash-dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
2026-06-22T19:35:37.315Z  Cep18:     hash-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
2026-06-22T19:35:37.315Z  Cep78:     hash-ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
2026-06-22T19:35:37.315Z  
2026-06-22T19:35:37.315Z  ## 1. register_agent (AgentFactory::deploy_agent)
2026-06-22T19:35:37.316Z    📤  register_agent(agent-1782156937315) submitted: mock-1de9231ceb14
2026-06-22T19:35:37.316Z  
2026-06-22T19:35:37.316Z  ## 2. attest_agent (Reputation)
2026-06-22T19:35:37.316Z    📤  attest_agent(agent-1782156937315,85) submitted: mock-fb5b8d3617df
2026-06-22T19:35:37.316Z  
2026-06-22T19:35:37.316Z  ## 3. get_reputation (view)
2026-06-22T19:35:37.316Z    📊  "mock"
2026-06-22T19:35:37.316Z  
2026-06-22T19:35:37.316Z  ## 4. escrow_deposit
2026-06-22T19:35:37.316Z    📤  escrow_deposit(agent-1782156937315,1.0 CSPR) submitted: mock-412c25297c94
2026-06-22T19:35:37.316Z  
2026-06-22T19:35:37.316Z  ## 5. escrow_payout
2026-06-22T19:35:37.316Z    📤  escrow_payout(agent-1782156937315) submitted: mock-b72367e2a629
2026-06-22T19:35:37.316Z  
2026-06-22T19:35:37.316Z  ## 6. Final state check (CSPR.cloud)
2026-06-22T19:35:38.317Z    ⚠️  CSPR.cloud check failed: This operation was aborted
2026-06-22T19:35:38.317Z  
2026-06-22T19:35:38.317Z  ## 7. compliance_attest (Compliance::attest_agent, emits Attest)
2026-06-22T19:35:38.317Z    📤  compliance_attest(verified=true) submitted: mock-9edd60a9d0d2
2026-06-22T19:35:38.317Z  
2026-06-22T19:35:38.317Z  ## 8. compliance_revoke (verified: true → false, emits RevokeAttestation)
2026-06-22T19:35:38.317Z    📤  compliance_revoke(verified=false) submitted: mock-0e2131aeaf19
2026-06-22T19:35:38.317Z  
2026-06-22T19:35:38.317Z  ## 9. set_paused(true) — AgentFactory, owner-only
2026-06-22T19:35:38.317Z    📤  set_paused(true) submitted: mock-f24970f5fb30
2026-06-22T19:35:38.317Z  
2026-06-22T19:35:38.317Z  ## 10. deploy_agent under pause → expect revert
2026-06-22T19:35:38.317Z    ✅  deploy_agent(under_pause) reverted as expected: User: 0 reverted: Error::Paused
2026-06-22T19:35:38.317Z  
2026-06-22T19:35:38.317Z  ## 11. set_paused(false) — resume
2026-06-22T19:35:38.318Z    📤  set_paused(false) submitted: mock-631930fde638
2026-06-22T19:35:38.318Z  
2026-06-22T19:35:38.318Z  ## 12. deploy_agent → expect success
2026-06-22T19:35:38.318Z    📤  deploy_agent(resumed) submitted: mock-51fb1ebd09ab
2026-06-22T19:35:38.318Z  
2026-06-22T19:35:38.318Z  ## 13. transfer_ownership(new_owner) — owner-only
2026-06-22T19:35:38.318Z    📤  transfer_ownership(01dddddd…) submitted: mock-14fa86abab46
2026-06-22T19:35:38.318Z  
2026-06-22T19:35:38.318Z  ## 14. deploy_agent under old owner → expect revert (post transfer)
2026-06-22T19:35:38.318Z    📤  deploy_agent(post_transfer) submitted: mock-885a46813589
2026-06-22T19:35:38.318Z  
2026-06-22T19:35:38.318Z  ## 14b. set_paused(true) → deploy_agent reverts (negative control)
2026-06-22T19:35:38.318Z    📤  set_paused(true) [post-transfer] submitted: mock-da74e35031c9
2026-06-22T19:35:38.318Z    ✅  deploy_agent(under_pause_post_transfer) reverted as expected: User: 0 reverted: Error::Paused
2026-06-22T19:35:38.318Z    📤  set_paused(false) [resume again] submitted: mock-b237f8bfacca
2026-06-22T19:35:38.318Z  
2026-06-22T19:35:38.318Z  ## 15. cep18_burn(amount=100) — holder-only, emits Burn
2026-06-22T19:35:38.318Z    📤  cep18_burn(100) submitted: mock-b35d1f16aa43
2026-06-22T19:35:38.318Z  
2026-06-22T19:35:38.318Z  ## 16. cep78_mint + cep78_burn — owner/operator, emits Burn
2026-06-22T19:35:38.318Z    📤  cep78_mint(recipient) submitted: mock-4b81fe78b890
2026-06-22T19:35:38.318Z    📤  cep78_burn(token_id=1) submitted: mock-c1b4be8adfb9
2026-06-22T19:35:38.318Z  
2026-06-22T19:35:38.318Z  ## 17. escrow_set_treasury — backend-only
2026-06-22T19:35:38.318Z    📤  set_treasury(01111111…) submitted: mock-44309b5bf3c7
2026-06-22T19:35:38.318Z  
2026-06-22T19:35:38.318Z  ## 18. on-chain event verification (CSPR.cloud events feed)
2026-06-22T19:35:38.318Z    📡  Emitted events (mock): {"Attest":2,"RevokeAttestation":1,"Burn":2}
2026-06-22T19:35:38.318Z  
2026-06-22T19:35:38.318Z  Run finished.
2026-06-22T19:35:54.335Z  # CasperOPs Testnet End-to-End Run (DRYRUN)
2026-06-22T19:35:54.335Z  Deployer: `010101010101010101010101010101010101010101010101010101010101010101` (ed25519 (mock))
2026-06-22T19:35:54.335Z  Mode: in-memory mock (no live RPC, no CSPR.cloud)
2026-06-22T19:35:54.335Z  Factory:   hash-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
2026-06-22T19:35:54.335Z  Reputation: hash-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
2026-06-22T19:35:54.335Z  Escrow:    hash-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
2026-06-22T19:35:54.335Z  Compliance: hash-dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
2026-06-22T19:35:54.335Z  Cep18:     hash-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
2026-06-22T19:35:54.335Z  Cep78:     hash-ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
2026-06-22T19:35:54.335Z  
2026-06-22T19:35:54.335Z  ## 1. register_agent (AgentFactory::deploy_agent)
2026-06-22T19:35:54.336Z    📤  register_agent(agent-1782156954335) submitted: mock-bbcc575749a0
2026-06-22T19:35:54.336Z  
2026-06-22T19:35:54.336Z  ## 2. attest_agent (Reputation)
2026-06-22T19:35:54.336Z    📤  attest_agent(agent-1782156954335,85) submitted: mock-566bd250e2bb
2026-06-22T19:35:54.336Z  
2026-06-22T19:35:54.336Z  ## 3. get_reputation (view)
2026-06-22T19:35:54.336Z    📊  "mock"
2026-06-22T19:35:54.336Z  
2026-06-22T19:35:54.336Z  ## 4. escrow_deposit
2026-06-22T19:35:54.336Z    📤  escrow_deposit(agent-1782156954335,1.0 CSPR) submitted: mock-4ad96d5c6c81
2026-06-22T19:35:54.336Z  
2026-06-22T19:35:54.336Z  ## 5. escrow_payout
2026-06-22T19:35:54.336Z    📤  escrow_payout(agent-1782156954335) submitted: mock-970c85c33e96
2026-06-22T19:35:54.336Z  
2026-06-22T19:35:54.336Z  ## 6. Final state check (CSPR.cloud)
2026-06-22T19:35:55.337Z    ⚠️  CSPR.cloud check failed: This operation was aborted
2026-06-22T19:35:55.337Z  
2026-06-22T19:35:55.337Z  ## 7. compliance_attest (Compliance::attest_agent, emits Attest)
2026-06-22T19:35:55.337Z    📤  compliance_attest(verified=true) submitted: mock-7fe636656b08
2026-06-22T19:35:55.337Z  
2026-06-22T19:35:55.337Z  ## 8. compliance_revoke (verified: true → false, emits RevokeAttestation)
2026-06-22T19:35:55.337Z    📤  compliance_revoke(verified=false) submitted: mock-984a789f2137
2026-06-22T19:35:55.337Z  
2026-06-22T19:35:55.337Z  ## 9. set_paused(true) — AgentFactory, owner-only
2026-06-22T19:35:55.337Z    📤  set_paused(true) submitted: mock-15560806248d
2026-06-22T19:35:55.337Z  
2026-06-22T19:35:55.337Z  ## 10. deploy_agent under pause → expect revert
2026-06-22T19:35:55.337Z    ✅  deploy_agent(under_pause) reverted as expected: User: 0 reverted: Error::Paused
2026-06-22T19:35:55.337Z  
2026-06-22T19:35:55.337Z  ## 11. set_paused(false) — resume
2026-06-22T19:35:55.337Z    📤  set_paused(false) submitted: mock-b7f63d74c9ea
2026-06-22T19:35:55.337Z  
2026-06-22T19:35:55.337Z  ## 12. deploy_agent → expect success
2026-06-22T19:35:55.337Z    📤  deploy_agent(resumed) submitted: mock-de261868faec
2026-06-22T19:35:55.337Z  
2026-06-22T19:35:55.337Z  ## 13. transfer_ownership(new_owner) — owner-only
2026-06-22T19:35:55.337Z    📤  transfer_ownership(01dddddd…) submitted: mock-149d3e9b1d9f
2026-06-22T19:35:55.337Z  
2026-06-22T19:35:55.337Z  ## 14. deploy_agent under old owner → expect revert (post transfer)
2026-06-22T19:35:55.337Z    📤  deploy_agent(post_transfer) submitted: mock-2904a9dd1523
2026-06-22T19:35:55.337Z  
2026-06-22T19:35:55.337Z  ## 14b. set_paused(true) → deploy_agent reverts (negative control)
2026-06-22T19:35:55.337Z    📤  set_paused(true) [post-transfer] submitted: mock-3ec51d0f5a6f
2026-06-22T19:35:55.337Z    ✅  deploy_agent(under_pause_post_transfer) reverted as expected: User: 0 reverted: Error::Paused
2026-06-22T19:35:55.337Z    📤  set_paused(false) [resume again] submitted: mock-3bae97ac23f2
2026-06-22T19:35:55.337Z  
2026-06-22T19:35:55.337Z  ## 15. cep18_burn(amount=100) — holder-only, emits Burn
2026-06-22T19:35:55.337Z    📤  cep18_burn(100) submitted: mock-0eb3c3db749c
2026-06-22T19:35:55.337Z  
2026-06-22T19:35:55.337Z  ## 16. cep78_mint + cep78_burn — owner/operator, emits Burn
2026-06-22T19:35:55.337Z    📤  cep78_mint(recipient) submitted: mock-7089b84508fc
2026-06-22T19:35:55.338Z    📤  cep78_burn(token_id=1) submitted: mock-11262a5f5fce
2026-06-22T19:35:55.338Z  
2026-06-22T19:35:55.338Z  ## 17. escrow_set_treasury — backend-only
2026-06-22T19:35:55.338Z    📤  set_treasury(01111111…) submitted: mock-db244e86f158
2026-06-22T19:35:55.338Z  
2026-06-22T19:35:55.338Z  ## 18. on-chain event verification (CSPR.cloud events feed)
2026-06-22T19:35:55.338Z    📡  Emitted events (mock): {"Attest":2,"RevokeAttestation":1,"Burn":2}
2026-06-22T19:35:55.338Z  
2026-06-22T19:35:55.338Z  Run finished.
2026-06-22T19:36:17.243Z  # CasperOPs Testnet End-to-End Run (DRYRUN)
2026-06-22T19:36:17.244Z  Deployer: `010101010101010101010101010101010101010101010101010101010101010101` (ed25519 (mock))
2026-06-22T19:36:17.244Z  Mode: in-memory mock (no live RPC, no CSPR.cloud)
2026-06-22T19:36:17.244Z  Factory:   hash-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
2026-06-22T19:36:17.244Z  Reputation: hash-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
2026-06-22T19:36:17.244Z  Escrow:    hash-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
2026-06-22T19:36:17.244Z  Compliance: hash-dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
2026-06-22T19:36:17.244Z  Cep18:     hash-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
2026-06-22T19:36:17.244Z  Cep78:     hash-ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
2026-06-22T19:36:17.244Z  
2026-06-22T19:36:17.244Z  ## 1. register_agent (AgentFactory::deploy_agent)
2026-06-22T19:36:17.244Z    📤  register_agent(agent-1782156977244) submitted: mock-99f03962b7c1
2026-06-22T19:36:17.245Z  
2026-06-22T19:36:17.245Z  ## 2. attest_agent (Reputation)
2026-06-22T19:36:17.245Z    📤  attest_agent(agent-1782156977244,85) submitted: mock-9870490578a8
2026-06-22T19:36:17.245Z  
2026-06-22T19:36:17.245Z  ## 3. get_reputation (view)
2026-06-22T19:36:17.245Z    📊  "mock"
2026-06-22T19:36:17.245Z  
2026-06-22T19:36:17.245Z  ## 4. escrow_deposit
2026-06-22T19:36:17.245Z    📤  escrow_deposit(agent-1782156977244,1.0 CSPR) submitted: mock-a22253593d74
2026-06-22T19:36:17.245Z  
2026-06-22T19:36:17.245Z  ## 5. escrow_payout
2026-06-22T19:36:17.245Z    📤  escrow_payout(agent-1782156977244) submitted: mock-c8e481ba24e3
2026-06-22T19:36:17.245Z  
2026-06-22T19:36:17.245Z  ## 6. Final state check (CSPR.cloud)
2026-06-22T19:36:18.246Z    ⚠️  CSPR.cloud check failed: This operation was aborted
2026-06-22T19:36:18.246Z  
2026-06-22T19:36:18.246Z  ## 7. compliance_attest (Compliance::attest_agent, emits Attest)
2026-06-22T19:36:18.247Z    📤  compliance_attest(verified=true) submitted: mock-f2f6bc6828fa
2026-06-22T19:36:18.247Z  
2026-06-22T19:36:18.247Z  ## 8. compliance_revoke (verified: true → false, emits RevokeAttestation)
2026-06-22T19:36:18.247Z    📤  compliance_revoke(verified=false) submitted: mock-e71e5a8a381a
2026-06-22T19:36:18.247Z  
2026-06-22T19:36:18.247Z  ## 9. set_paused(true) — AgentFactory, owner-only
2026-06-22T19:36:18.247Z    📤  set_paused(true) submitted: mock-cf96c235d9c4
2026-06-22T19:36:18.247Z  
2026-06-22T19:36:18.247Z  ## 10. deploy_agent under pause → expect revert
2026-06-22T19:36:18.247Z    ✅  deploy_agent(under_pause) reverted as expected: User: 0 reverted: Error::Paused
2026-06-22T19:36:18.247Z  
2026-06-22T19:36:18.247Z  ## 11. set_paused(false) — resume
2026-06-22T19:36:18.247Z    📤  set_paused(false) submitted: mock-7f6cef4ee522
2026-06-22T19:36:18.247Z  
2026-06-22T19:36:18.247Z  ## 12. deploy_agent → expect success
2026-06-22T19:36:18.247Z    📤  deploy_agent(resumed) submitted: mock-e8a2f591d720
2026-06-22T19:36:18.247Z  
2026-06-22T19:36:18.247Z  ## 13. transfer_ownership(new_owner) — owner-only
2026-06-22T19:36:18.247Z    📤  transfer_ownership(01dddddd…) submitted: mock-535002cc535d
2026-06-22T19:36:18.247Z  
2026-06-22T19:36:18.247Z  ## 14. deploy_agent under old owner → expect revert (post transfer)
2026-06-22T19:36:18.247Z    📤  deploy_agent(post_transfer) submitted: mock-ff00b9c6980b
2026-06-22T19:36:18.247Z  
2026-06-22T19:36:18.247Z  ## 14b. set_paused(true) → deploy_agent reverts (negative control)
2026-06-22T19:36:18.247Z    📤  set_paused(true) [post-transfer] submitted: mock-14fc8f29655b
2026-06-22T19:36:18.247Z    ✅  deploy_agent(under_pause_post_transfer) reverted as expected: User: 0 reverted: Error::Paused
2026-06-22T19:36:18.247Z    📤  set_paused(false) [resume again] submitted: mock-f7d2dfc471ed
2026-06-22T19:36:18.247Z  
2026-06-22T19:36:18.247Z  ## 15. cep18_burn(amount=100) — holder-only, emits Burn
2026-06-22T19:36:18.247Z    📤  cep18_burn(100) submitted: mock-8cfd46ac718e
2026-06-22T19:36:18.247Z  
2026-06-22T19:36:18.247Z  ## 16. cep78_mint + cep78_burn — owner/operator, emits Burn
2026-06-22T19:36:18.247Z    📤  cep78_mint(recipient) submitted: mock-7b7385f37116
2026-06-22T19:36:18.247Z    📤  cep78_burn(token_id=1) submitted: mock-46e1554f599d
2026-06-22T19:36:18.247Z  
2026-06-22T19:36:18.247Z  ## 17. escrow_set_treasury — backend-only
2026-06-22T19:36:18.247Z    📤  set_treasury(01111111…) submitted: mock-f300d7cf59d5
2026-06-22T19:36:18.247Z  
2026-06-22T19:36:18.247Z  ## 18. on-chain event verification (CSPR.cloud events feed)
2026-06-22T19:36:18.247Z    📡  Emitted events (mock): {"Attest":2,"RevokeAttestation":1,"Burn":2}
2026-06-22T19:36:18.247Z  
2026-06-22T19:36:18.247Z  Run finished.
2026-06-22T19:36:51.484Z  # CasperOPs Testnet End-to-End Run (DRYRUN)
2026-06-22T19:36:51.485Z  Deployer: `010101010101010101010101010101010101010101010101010101010101010101` (ed25519 (mock))
2026-06-22T19:36:51.485Z  Mode: in-memory mock (no live RPC, no CSPR.cloud)
2026-06-22T19:36:51.485Z  Factory:   hash-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
2026-06-22T19:36:51.485Z  Reputation: hash-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
2026-06-22T19:36:51.485Z  Escrow:    hash-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
2026-06-22T19:36:51.485Z  Compliance: hash-dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
2026-06-22T19:36:51.485Z  Cep18:     hash-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
2026-06-22T19:36:51.485Z  Cep78:     hash-ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
2026-06-22T19:36:51.485Z  
2026-06-22T19:36:51.485Z  ## 1. register_agent (AgentFactory::deploy_agent)
2026-06-22T19:36:51.486Z    📤  register_agent(agent-1782157011485) submitted: mock-1698b0b526cc
2026-06-22T19:36:51.486Z  
2026-06-22T19:36:51.486Z  ## 2. attest_agent (Reputation)
2026-06-22T19:36:51.486Z    📤  attest_agent(agent-1782157011485,85) submitted: mock-cc6a8f72140d
2026-06-22T19:36:51.486Z  
2026-06-22T19:36:51.486Z  ## 3. get_reputation (view)
2026-06-22T19:36:51.486Z    📊  "mock"
2026-06-22T19:36:51.486Z  
2026-06-22T19:36:51.486Z  ## 4. escrow_deposit
2026-06-22T19:36:51.486Z    📤  escrow_deposit(agent-1782157011485,1.0 CSPR) submitted: mock-86807b9d5d8b
2026-06-22T19:36:51.486Z  
2026-06-22T19:36:51.486Z  ## 5. escrow_payout
2026-06-22T19:36:51.486Z    📤  escrow_payout(agent-1782157011485) submitted: mock-6241eccfa849
2026-06-22T19:36:51.486Z  
2026-06-22T19:36:51.486Z  ## 6. Final state check (CSPR.cloud)
2026-06-22T19:36:52.487Z    ⚠️  CSPR.cloud check failed: This operation was aborted
2026-06-22T19:36:52.488Z  
2026-06-22T19:36:52.488Z  ## 7. compliance_attest (Compliance::attest_agent, emits Attest)
2026-06-22T19:36:52.488Z    📤  compliance_attest(verified=true) submitted: mock-61e144ebc093
2026-06-22T19:36:52.488Z  
2026-06-22T19:36:52.488Z  ## 8. compliance_revoke (verified: true → false, emits RevokeAttestation)
2026-06-22T19:36:52.488Z    📤  compliance_revoke(verified=false) submitted: mock-d61d45cb03ca
2026-06-22T19:36:52.488Z  
2026-06-22T19:36:52.488Z  ## 9. set_paused(true) — AgentFactory, owner-only
2026-06-22T19:36:52.488Z    📤  set_paused(true) submitted: mock-ae6975a439a0
2026-06-22T19:36:52.488Z  
2026-06-22T19:36:52.488Z  ## 10. deploy_agent under pause → expect revert
2026-06-22T19:36:52.488Z    ✅  deploy_agent(under_pause) reverted as expected: User: 0 reverted: Error::Paused
2026-06-22T19:36:52.488Z  
2026-06-22T19:36:52.488Z  ## 11. set_paused(false) — resume
2026-06-22T19:36:52.488Z    📤  set_paused(false) submitted: mock-dee9322b4ad2
2026-06-22T19:36:52.488Z  
2026-06-22T19:36:52.488Z  ## 12. deploy_agent → expect success
2026-06-22T19:36:52.488Z    📤  deploy_agent(resumed) submitted: mock-1290fa342283
2026-06-22T19:36:52.488Z  
2026-06-22T19:36:52.488Z  ## 13. transfer_ownership(new_owner) — owner-only
2026-06-22T19:36:52.488Z    📤  transfer_ownership(01dddddd…) submitted: mock-b6f61505a2f2
2026-06-22T19:36:52.488Z  
2026-06-22T19:36:52.488Z  ## 14. deploy_agent under old owner → expect revert (post transfer)
2026-06-22T19:36:52.488Z    📤  deploy_agent(post_transfer) submitted: mock-bc61f3b00616
2026-06-22T19:36:52.488Z  
2026-06-22T19:36:52.488Z  ## 14b. set_paused(true) → deploy_agent reverts (negative control)
2026-06-22T19:36:52.488Z    📤  set_paused(true) [post-transfer] submitted: mock-ebf7fa1117fc
2026-06-22T19:36:52.489Z    ✅  deploy_agent(under_pause_post_transfer) reverted as expected: User: 0 reverted: Error::Paused
2026-06-22T19:36:52.489Z    📤  set_paused(false) [resume again] submitted: mock-a4483366fa6a
2026-06-22T19:36:52.489Z  
2026-06-22T19:36:52.489Z  ## 15. cep18_burn(amount=100) — holder-only, emits Burn
2026-06-22T19:36:52.489Z    📤  cep18_burn(100) submitted: mock-ab604828dffa
2026-06-22T19:36:52.489Z  
2026-06-22T19:36:52.489Z  ## 16. cep78_mint + cep78_burn — owner/operator, emits Burn
2026-06-22T19:36:52.489Z    📤  cep78_mint(recipient) submitted: mock-fa7c162db803
2026-06-22T19:36:52.489Z    📤  cep78_burn(token_id=1) submitted: mock-7f92ffe130d1
2026-06-22T19:36:52.489Z  
2026-06-22T19:36:52.489Z  ## 17. escrow_set_treasury — backend-only
2026-06-22T19:36:52.489Z    📤  set_treasury(01111111…) submitted: mock-2fab9aa6a6f8
2026-06-22T19:36:52.489Z  
2026-06-22T19:36:52.489Z  ## 18. on-chain event verification (CSPR.cloud events feed)
2026-06-22T19:36:52.489Z    📡  Emitted events (mock): {"Attest":2,"RevokeAttestation":1,"Burn":2}
2026-06-22T19:36:52.489Z  
2026-06-22T19:36:52.489Z  Run finished.
2026-06-22T19:57:02.892Z  # CasperOPs Testnet End-to-End Run (DRYRUN)
2026-06-22T19:57:02.892Z  Deployer: `010101010101010101010101010101010101010101010101010101010101010101` (ed25519 (mock))
2026-06-22T19:57:02.892Z  Mode: in-memory mock (no live RPC, no CSPR.cloud)
2026-06-22T19:57:02.892Z  Factory:   hash-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
2026-06-22T19:57:02.892Z  Reputation: hash-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
2026-06-22T19:57:02.892Z  Escrow:    hash-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
2026-06-22T19:57:02.892Z  Compliance: hash-dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
2026-06-22T19:57:02.892Z  Cep18:     hash-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
2026-06-22T19:57:02.892Z  Cep78:     hash-ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
2026-06-22T19:57:02.892Z  
2026-06-22T19:57:02.892Z  ## 1. register_agent (AgentFactory::deploy_agent)
2026-06-22T19:57:02.893Z    📤  register_agent(agent-1782158222893) submitted: mock-eaec9dc13dbc
2026-06-22T19:57:02.893Z  
2026-06-22T19:57:02.893Z  ## 2. attest_agent (Reputation)
2026-06-22T19:57:02.893Z    📤  attest_agent(agent-1782158222893,85) submitted: mock-a6ec425ca0a9
2026-06-22T19:57:02.893Z  
2026-06-22T19:57:02.893Z  ## 3. get_reputation (view)
2026-06-22T19:57:02.893Z    📊  "mock"
2026-06-22T19:57:02.893Z  
2026-06-22T19:57:02.893Z  ## 4. escrow_deposit
2026-06-22T19:57:02.893Z    📤  escrow_deposit(agent-1782158222893,1.0 CSPR) submitted: mock-94aa042f5503
2026-06-22T19:57:02.893Z  
2026-06-22T19:57:02.893Z  ## 5. escrow_payout
2026-06-22T19:57:02.893Z    📤  escrow_payout(agent-1782158222893) submitted: mock-0054446972f2
2026-06-22T19:57:02.893Z  
2026-06-22T19:57:02.893Z  ## 6. Final state check (CSPR.cloud)
2026-06-22T19:57:03.894Z    ⚠️  CSPR.cloud check failed: This operation was aborted
2026-06-22T19:57:03.894Z  
2026-06-22T19:57:03.894Z  ## 7. compliance_attest (Compliance::attest_agent, emits Attest)
2026-06-22T19:57:03.894Z    📤  compliance_attest(verified=true) submitted: mock-a12a3f950093
2026-06-22T19:57:03.894Z  
2026-06-22T19:57:03.894Z  ## 8. compliance_revoke (verified: true → false, emits RevokeAttestation)
2026-06-22T19:57:03.894Z    📤  compliance_revoke(verified=false) submitted: mock-d510e1985295
2026-06-22T19:57:03.894Z  
2026-06-22T19:57:03.894Z  ## 9. set_paused(true) — AgentFactory, owner-only
2026-06-22T19:57:03.894Z    📤  set_paused(true) submitted: mock-30fbe63a11c3
2026-06-22T19:57:03.894Z  
2026-06-22T19:57:03.894Z  ## 10. deploy_agent under pause → expect revert
2026-06-22T19:57:03.894Z    ✅  deploy_agent(under_pause) reverted as expected: User: 0 reverted: Error::Paused
2026-06-22T19:57:03.894Z  
2026-06-22T19:57:03.894Z  ## 11. set_paused(false) — resume
2026-06-22T19:57:03.894Z    📤  set_paused(false) submitted: mock-bd1f16416767
2026-06-22T19:57:03.894Z  
2026-06-22T19:57:03.894Z  ## 12. deploy_agent → expect success
2026-06-22T19:57:03.894Z    📤  deploy_agent(resumed) submitted: mock-01c03af449a0
2026-06-22T19:57:03.894Z  
2026-06-22T19:57:03.894Z  ## 13. transfer_ownership(new_owner) — owner-only
2026-06-22T19:57:03.894Z    📤  transfer_ownership(01dddddd…) submitted: mock-afaacd31eca3
2026-06-22T19:57:03.894Z  
2026-06-22T19:57:03.894Z  ## 14. deploy_agent under old owner → expect revert (post transfer)
2026-06-22T19:57:03.894Z    📤  deploy_agent(post_transfer) submitted: mock-ca548408936d
2026-06-22T19:57:03.894Z  
2026-06-22T19:57:03.894Z  ## 14b. set_paused(true) → deploy_agent reverts (negative control)
2026-06-22T19:57:03.894Z    📤  set_paused(true) [post-transfer] submitted: mock-24ecddc489e8
2026-06-22T19:57:03.894Z    ✅  deploy_agent(under_pause_post_transfer) reverted as expected: User: 0 reverted: Error::Paused
2026-06-22T19:57:03.894Z    📤  set_paused(false) [resume again] submitted: mock-64f671e8c4be
2026-06-22T19:57:03.894Z  
2026-06-22T19:57:03.894Z  ## 15. cep18_burn(amount=100) — holder-only, emits Burn
2026-06-22T19:57:03.894Z    📤  cep18_burn(100) submitted: mock-4fcb545c8441
2026-06-22T19:57:03.894Z  
2026-06-22T19:57:03.894Z  ## 16. cep78_mint + cep78_burn — owner/operator, emits Burn
2026-06-22T19:57:03.895Z    📤  cep78_mint(recipient) submitted: mock-ce03b3ba6150
2026-06-22T19:57:03.895Z    📤  cep78_burn(token_id=1) submitted: mock-6e4a2bdfabe9
2026-06-22T19:57:03.895Z  
2026-06-22T19:57:03.895Z  ## 17. escrow_set_treasury — backend-only
2026-06-22T19:57:03.895Z    📤  set_treasury(01111111…) submitted: mock-e29f533515e9
2026-06-22T19:57:03.895Z  
2026-06-22T19:57:03.895Z  ## 18. on-chain event verification (CSPR.cloud events feed)
2026-06-22T19:57:03.895Z    📡  Emitted events (mock): {"Attest":2,"RevokeAttestation":1,"Burn":2}
2026-06-22T19:57:03.895Z  
2026-06-22T19:57:03.895Z  Run finished.
2026-06-22T19:58:49.966Z  # CasperOPs Testnet End-to-End Run (DRYRUN)
2026-06-22T19:58:49.966Z  Deployer: `010101010101010101010101010101010101010101010101010101010101010101` (ed25519 (mock))
2026-06-22T19:58:49.966Z  Mode: in-memory mock (no live RPC, no CSPR.cloud)
2026-06-22T19:58:49.966Z  Factory:   hash-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
2026-06-22T19:58:49.966Z  Reputation: hash-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
2026-06-22T19:58:49.966Z  Escrow:    hash-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
2026-06-22T19:58:49.966Z  Compliance: hash-dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
2026-06-22T19:58:49.966Z  Cep18:     hash-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
2026-06-22T19:58:49.966Z  Cep78:     hash-ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
2026-06-22T19:58:49.966Z  
2026-06-22T19:58:49.966Z  ## 1. register_agent (AgentFactory::deploy_agent)
2026-06-22T19:58:49.967Z    📤  register_agent(agent-1782158329966) submitted: mock-7022ffe122af
2026-06-22T19:58:49.967Z  
2026-06-22T19:58:49.967Z  ## 2. attest_agent (Reputation)
2026-06-22T19:58:49.967Z    📤  attest_agent(agent-1782158329966,85) submitted: mock-cbfe69cb467f
2026-06-22T19:58:49.967Z  
2026-06-22T19:58:49.967Z  ## 3. get_reputation (view)
2026-06-22T19:58:49.967Z    📊  "mock"
2026-06-22T19:58:49.967Z  
2026-06-22T19:58:49.967Z  ## 4. escrow_deposit
2026-06-22T19:58:49.967Z    📤  escrow_deposit(agent-1782158329966,1.0 CSPR) submitted: mock-d4ac42fe6645
2026-06-22T19:58:49.967Z  
2026-06-22T19:58:49.967Z  ## 5. escrow_payout
2026-06-22T19:58:49.967Z    📤  escrow_payout(agent-1782158329966) submitted: mock-839344f5f70b
2026-06-22T19:58:49.967Z  
2026-06-22T19:58:49.967Z  ## 6. Final state check (CSPR.cloud)
2026-06-22T19:58:50.968Z    ⚠️  CSPR.cloud check failed: This operation was aborted
2026-06-22T19:58:50.969Z  
2026-06-22T19:58:50.969Z  ## 7. compliance_attest (Compliance::attest_agent, emits Attest)
2026-06-22T19:58:50.969Z    📤  compliance_attest(verified=true) submitted: mock-8d1aa64427c0
2026-06-22T19:58:50.969Z  
2026-06-22T19:58:50.969Z  ## 8. compliance_revoke (verified: true → false, emits RevokeAttestation)
2026-06-22T19:58:50.969Z    📤  compliance_revoke(verified=false) submitted: mock-e434ba371055
2026-06-22T19:58:50.969Z  
2026-06-22T19:58:50.969Z  ## 9. set_paused(true) — AgentFactory, owner-only
2026-06-22T19:58:50.969Z    📤  set_paused(true) submitted: mock-d50a0cf3dfa5
2026-06-22T19:58:50.969Z  
2026-06-22T19:58:50.969Z  ## 10. deploy_agent under pause → expect revert
2026-06-22T19:58:50.969Z    ✅  deploy_agent(under_pause) reverted as expected: User: 0 reverted: Error::Paused
2026-06-22T19:58:50.969Z  
2026-06-22T19:58:50.969Z  ## 11. set_paused(false) — resume
2026-06-22T19:58:50.969Z    📤  set_paused(false) submitted: mock-df9e5d9e95a6
2026-06-22T19:58:50.969Z  
2026-06-22T19:58:50.969Z  ## 12. deploy_agent → expect success
2026-06-22T19:58:50.969Z    📤  deploy_agent(resumed) submitted: mock-aa3da3415473
2026-06-22T19:58:50.969Z  
2026-06-22T19:58:50.969Z  ## 13. transfer_ownership(new_owner) — owner-only
2026-06-22T19:58:50.969Z    📤  transfer_ownership(01dddddd…) submitted: mock-f8dd999c7b96
2026-06-22T19:58:50.969Z  
2026-06-22T19:58:50.969Z  ## 14. deploy_agent under old owner → expect revert (post transfer)
2026-06-22T19:58:50.969Z    📤  deploy_agent(post_transfer) submitted: mock-b657eb4f6f77
2026-06-22T19:58:50.969Z  
2026-06-22T19:58:50.969Z  ## 14b. set_paused(true) → deploy_agent reverts (negative control)
2026-06-22T19:58:50.969Z    📤  set_paused(true) [post-transfer] submitted: mock-48304f1153bf
2026-06-22T19:58:50.969Z    ✅  deploy_agent(under_pause_post_transfer) reverted as expected: User: 0 reverted: Error::Paused
2026-06-22T19:58:50.969Z    📤  set_paused(false) [resume again] submitted: mock-225a3fe0fb5d
2026-06-22T19:58:50.969Z  
2026-06-22T19:58:50.969Z  ## 15. cep18_burn(amount=100) — holder-only, emits Burn
2026-06-22T19:58:50.969Z    📤  cep18_burn(100) submitted: mock-6cca57653f3c
2026-06-22T19:58:50.969Z  
2026-06-22T19:58:50.969Z  ## 16. cep78_mint + cep78_burn — owner/operator, emits Burn
2026-06-22T19:58:50.969Z    📤  cep78_mint(recipient) submitted: mock-622c522f6823
2026-06-22T19:58:50.969Z    📤  cep78_burn(token_id=1) submitted: mock-ae6aab860eea
2026-06-22T19:58:50.969Z  
2026-06-22T19:58:50.969Z  ## 17. escrow_set_treasury — backend-only
2026-06-22T19:58:50.969Z    📤  set_treasury(01111111…) submitted: mock-07732c8e6449
2026-06-22T19:58:50.969Z  
2026-06-22T19:58:50.969Z  ## 18. on-chain event verification (CSPR.cloud events feed)
2026-06-22T19:58:50.969Z    📡  Emitted events (mock): {"Attest":2,"RevokeAttestation":1,"Burn":2}
2026-06-22T19:58:50.969Z  
2026-06-22T19:58:50.969Z  Run finished.
2026-06-22T20:01:59.007Z  # CasperOPs Testnet End-to-End Run (DRYRUN)
2026-06-22T20:01:59.008Z  Deployer: `010101010101010101010101010101010101010101010101010101010101010101` (ed25519 (mock))
2026-06-22T20:01:59.008Z  Mode: in-memory mock (no live RPC, no CSPR.cloud)
2026-06-22T20:01:59.008Z  Factory:   hash-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
2026-06-22T20:01:59.008Z  Reputation: hash-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
2026-06-22T20:01:59.008Z  Escrow:    hash-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
2026-06-22T20:01:59.008Z  Compliance: hash-dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
2026-06-22T20:01:59.008Z  Cep18:     hash-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
2026-06-22T20:01:59.008Z  Cep78:     hash-ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
2026-06-22T20:01:59.008Z  
2026-06-22T20:01:59.008Z  ## 1. register_agent (AgentFactory::deploy_agent)
2026-06-22T20:01:59.009Z    📤  register_agent(agent-1782158519008) submitted: mock-d5fbbe54689b
2026-06-22T20:01:59.009Z  
2026-06-22T20:01:59.009Z  ## 2. attest_agent (Reputation)
2026-06-22T20:01:59.009Z    📤  attest_agent(agent-1782158519008,85) submitted: mock-733cb1d70520
2026-06-22T20:01:59.009Z  
2026-06-22T20:01:59.009Z  ## 3. get_reputation (view)
2026-06-22T20:01:59.009Z    📊  "mock"
2026-06-22T20:01:59.009Z  
2026-06-22T20:01:59.009Z  ## 4. escrow_deposit
2026-06-22T20:01:59.009Z    📤  escrow_deposit(agent-1782158519008,1.0 CSPR) submitted: mock-e3304f5421e1
2026-06-22T20:01:59.009Z  
2026-06-22T20:01:59.009Z  ## 5. escrow_payout
2026-06-22T20:01:59.009Z    📤  escrow_payout(agent-1782158519008) submitted: mock-797c66192efc
2026-06-22T20:01:59.009Z  
2026-06-22T20:01:59.009Z  ## 6. Final state check (CSPR.cloud)
2026-06-22T20:02:00.010Z    ⚠️  CSPR.cloud check failed: This operation was aborted
2026-06-22T20:02:00.010Z  
2026-06-22T20:02:00.010Z  ## 7. compliance_attest (Compliance::attest_agent, emits Attest)
2026-06-22T20:02:00.010Z    📤  compliance_attest(verified=true) submitted: mock-df8b837170dc
2026-06-22T20:02:00.010Z  
2026-06-22T20:02:00.010Z  ## 8. compliance_revoke (verified: true → false, emits RevokeAttestation)
2026-06-22T20:02:00.010Z    📤  compliance_revoke(verified=false) submitted: mock-8ae6e3b22f2c
2026-06-22T20:02:00.010Z  
2026-06-22T20:02:00.010Z  ## 9. set_paused(true) — AgentFactory, owner-only
2026-06-22T20:02:00.010Z    📤  set_paused(true) submitted: mock-cb1aaa407e3f
2026-06-22T20:02:00.010Z  
2026-06-22T20:02:00.010Z  ## 10. deploy_agent under pause → expect revert
2026-06-22T20:02:00.010Z    ✅  deploy_agent(under_pause) reverted as expected: User: 0 reverted: Error::Paused
2026-06-22T20:02:00.010Z  
2026-06-22T20:02:00.010Z  ## 11. set_paused(false) — resume
2026-06-22T20:02:00.010Z    📤  set_paused(false) submitted: mock-e359424a1ab5
2026-06-22T20:02:00.010Z  
2026-06-22T20:02:00.010Z  ## 12. deploy_agent → expect success
2026-06-22T20:02:00.010Z    📤  deploy_agent(resumed) submitted: mock-cc3ec4a7ff3f
2026-06-22T20:02:00.010Z  
2026-06-22T20:02:00.010Z  ## 13. transfer_ownership(new_owner) — owner-only
2026-06-22T20:02:00.010Z    📤  transfer_ownership(01dddddd…) submitted: mock-afc1ed8244ed
2026-06-22T20:02:00.010Z  
2026-06-22T20:02:00.010Z  ## 14. deploy_agent under old owner → expect revert (post transfer)
2026-06-22T20:02:00.010Z    📤  deploy_agent(post_transfer) submitted: mock-e03879f985fe
2026-06-22T20:02:00.010Z  
2026-06-22T20:02:00.010Z  ## 14b. set_paused(true) → deploy_agent reverts (negative control)
2026-06-22T20:02:00.010Z    📤  set_paused(true) [post-transfer] submitted: mock-29862a0ddecf
2026-06-22T20:02:00.010Z    ✅  deploy_agent(under_pause_post_transfer) reverted as expected: User: 0 reverted: Error::Paused
2026-06-22T20:02:00.010Z    📤  set_paused(false) [resume again] submitted: mock-25d8cd9918c8
2026-06-22T20:02:00.010Z  
2026-06-22T20:02:00.010Z  ## 15. cep18_burn(amount=100) — holder-only, emits Burn
2026-06-22T20:02:00.011Z    📤  cep18_burn(100) submitted: mock-a2171d8ddb07
2026-06-22T20:02:00.011Z  
2026-06-22T20:02:00.011Z  ## 16. cep78_mint + cep78_burn — owner/operator, emits Burn
2026-06-22T20:02:00.011Z    📤  cep78_mint(recipient) submitted: mock-2d19819ecae5
2026-06-22T20:02:00.011Z    📤  cep78_burn(token_id=1) submitted: mock-9375d60fa799
2026-06-22T20:02:00.011Z  
2026-06-22T20:02:00.011Z  ## 17. escrow_set_treasury — backend-only
2026-06-22T20:02:00.011Z    📤  set_treasury(01111111…) submitted: mock-94be755cd0e7
2026-06-22T20:02:00.011Z  
2026-06-22T20:02:00.011Z  ## 18. on-chain event verification (CSPR.cloud events feed)
2026-06-22T20:02:00.011Z    📡  Emitted events (mock): {"Attest":2,"RevokeAttestation":1,"Burn":2}
2026-06-22T20:02:00.011Z  
2026-06-22T20:02:00.011Z  Run finished.
2026-06-22T23:26:54.121Z  # CasperOPs Testnet End-to-End Run (DRYRUN)
2026-06-22T23:26:54.121Z  Deployer: `010101010101010101010101010101010101010101010101010101010101010101` (ed25519 (mock))
2026-06-22T23:26:54.121Z  Mode: in-memory mock (no live RPC, no CSPR.cloud)
2026-06-22T23:26:54.121Z  Factory:   hash-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
2026-06-22T23:26:54.121Z  Reputation: hash-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
2026-06-22T23:26:54.121Z  Escrow:    hash-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
2026-06-22T23:26:54.121Z  Compliance: hash-dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
2026-06-22T23:26:54.121Z  Cep18:     hash-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
2026-06-22T23:26:54.121Z  Cep78:     hash-ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
2026-06-22T23:26:54.121Z  
2026-06-22T23:26:54.121Z  ## 1. register_agent (AgentFactory::deploy_agent)
2026-06-22T23:26:54.122Z    📤  register_agent(agent-1782170814121) submitted: mock-138220e9744c
2026-06-22T23:26:54.122Z  
2026-06-22T23:26:54.122Z  ## 2. attest_agent (Reputation)
2026-06-22T23:26:54.122Z    📤  attest_agent(agent-1782170814121,85) submitted: mock-123a072c84bc
2026-06-22T23:26:54.122Z  
2026-06-22T23:26:54.122Z  ## 3. get_reputation (view)
2026-06-22T23:26:54.122Z    📊  "mock"
2026-06-22T23:26:54.122Z  
2026-06-22T23:26:54.122Z  ## 4. escrow_deposit
2026-06-22T23:26:54.122Z    📤  escrow_deposit(agent-1782170814121,1.0 CSPR) submitted: mock-ac0178b66ee5
2026-06-22T23:26:54.122Z  
2026-06-22T23:26:54.122Z  ## 5. escrow_payout
2026-06-22T23:26:54.122Z    📤  escrow_payout(agent-1782170814121) submitted: mock-3a37d43f2014
2026-06-22T23:26:54.122Z  
2026-06-22T23:26:54.122Z  ## 6. Final state check (CSPR.cloud)
2026-06-22T23:26:55.123Z    ⚠️  CSPR.cloud check failed: This operation was aborted
2026-06-22T23:26:55.123Z  
2026-06-22T23:26:55.123Z  ## 7. compliance_attest (Compliance::attest_agent, emits Attest)
2026-06-22T23:26:55.123Z    📤  compliance_attest(verified=true) submitted: mock-be004ddf9315
2026-06-22T23:26:55.123Z  
2026-06-22T23:26:55.123Z  ## 8. compliance_revoke (verified: true → false, emits RevokeAttestation)
2026-06-22T23:26:55.123Z    📤  compliance_revoke(verified=false) submitted: mock-0a30130b3036
2026-06-22T23:26:55.123Z  
2026-06-22T23:26:55.123Z  ## 9. set_paused(true) — AgentFactory, owner-only
2026-06-22T23:26:55.123Z    📤  set_paused(true) submitted: mock-6fa12dd8dc7c
2026-06-22T23:26:55.123Z  
2026-06-22T23:26:55.123Z  ## 10. deploy_agent under pause → expect revert
2026-06-22T23:26:55.123Z    ✅  deploy_agent(under_pause) reverted as expected: User: 0 reverted: Error::Paused
2026-06-22T23:26:55.123Z  
2026-06-22T23:26:55.123Z  ## 11. set_paused(false) — resume
2026-06-22T23:26:55.123Z    📤  set_paused(false) submitted: mock-d6754be1f7f3
2026-06-22T23:26:55.123Z  
2026-06-22T23:26:55.123Z  ## 12. deploy_agent → expect success
2026-06-22T23:26:55.123Z    📤  deploy_agent(resumed) submitted: mock-8321a8a79b00
2026-06-22T23:26:55.123Z  
2026-06-22T23:26:55.123Z  ## 13. transfer_ownership(new_owner) — owner-only
2026-06-22T23:26:55.123Z    📤  transfer_ownership(01dddddd…) submitted: mock-353af4ef6595
2026-06-22T23:26:55.123Z  
2026-06-22T23:26:55.123Z  ## 14. deploy_agent under old owner → expect revert (post transfer)
2026-06-22T23:26:55.123Z    📤  deploy_agent(post_transfer) submitted: mock-37bca309c501
2026-06-22T23:26:55.123Z  
2026-06-22T23:26:55.123Z  ## 14b. set_paused(true) → deploy_agent reverts (negative control)
2026-06-22T23:26:55.123Z    📤  set_paused(true) [post-transfer] submitted: mock-4262ce80423d
2026-06-22T23:26:55.123Z    ✅  deploy_agent(under_pause_post_transfer) reverted as expected: User: 0 reverted: Error::Paused
2026-06-22T23:26:55.123Z    📤  set_paused(false) [resume again] submitted: mock-e9eb294979f1
2026-06-22T23:26:55.123Z  
2026-06-22T23:26:55.123Z  ## 15. cep18_burn(amount=100) — holder-only, emits Burn
2026-06-22T23:26:55.123Z    📤  cep18_burn(100) submitted: mock-92272c122df6
2026-06-22T23:26:55.123Z  
2026-06-22T23:26:55.123Z  ## 16. cep78_mint + cep78_burn — owner/operator, emits Burn
2026-06-22T23:26:55.124Z    📤  cep78_mint(recipient) submitted: mock-ace6b7fd3692
2026-06-22T23:26:55.124Z    📤  cep78_burn(token_id=1) submitted: mock-22d6f7efed73
2026-06-22T23:26:55.124Z  
2026-06-22T23:26:55.124Z  ## 17. escrow_set_treasury — backend-only
2026-06-22T23:26:55.124Z    📤  set_treasury(01111111…) submitted: mock-bf276eca6dcd
2026-06-22T23:26:55.124Z  
2026-06-22T23:26:55.124Z  ## 18. on-chain event verification (CSPR.cloud events feed)
2026-06-22T23:26:55.124Z    📡  Emitted events (mock): {"Attest":2,"RevokeAttestation":1,"Burn":2}
2026-06-22T23:26:55.124Z  
2026-06-22T23:26:55.124Z  Run finished.
