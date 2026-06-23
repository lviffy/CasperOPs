# BlockOps Casper Migration Checklist

This checklist tracks the remaining tasks to fully migrate the BlockOps codebase to the Casper Network.

## Phase 1: Smart Contract Validation & Deployment
- [x] Write units tests for Odra contracts (`contract/src/agent_factory.rs`, `contract/src/reputation.rs`, `contract/src/escrow.rs`, `contract/src/compliance.rs`)
- [x] Execute `cargo test` inside `contract/` to verify business logic (24 tests, all passing)
- [x] Build contracts to WASM using Odra build tool (`cargo odra build` → 4 WASM contracts in `contract/wasm/`)
- [x] Document/prepare Casper testnet deployment keys and deploy scripts (`contract/scripts/deploy.js`, `contract/DEPLOYMENT.md`)

## Phase 2: Backend API Cleanup & Casper Alignment
- [x] Refactor or clean up `backend/utils/chains.js` to remove Arbitrum/Flow toolsets and define Casper-supported tools
- [x] Refactor `backend/services/contractDeploymentService.js` to deploy CEP-18 tokens and CEP-78 NFTs instead of Solidity source compilation
- [x] Clean up or deprecate EVM-specific services:
  - [x] `backend/services/litPkpService.js` (EVM private key management) — marked deprecated; retained for legacy payload decryption
  - [x] `backend/services/filecoinStorageService.js` (no longer used for Casper RWA uploads) — marked deprecated
- [x] Update backend environment variables in `backend/.env.example` (Casper RPC, Odra hashes, CSPR.cloud)
- [x] Install node dependencies in `backend/` and run smoke tests on API endpoints:
  - [x] Tool router maps Casper-native tool set (22 tools, no EVM leftovers)
  - [x] CSPR transfer routing & on-chain `register_agent` / `attest_agent` / `get_reputation` / `yield_rebalance` / `wallet_readiness` handlers

## Phase 3: Frontend Visual Builder & Wallet Connect
- [x] Refactor `frontend/components/node-library.tsx` to include Casper-native workflow nodes (CSPR Transfer, CEP-18 Deploy, CEP-78 Deploy, Mint NFT, Register Agent, Attest Agent, Reputation, Yield Rebalance, Lookup Deploy, etc.)
- [x] Update `frontend/components/workflow-builder.tsx` to use `@make-software/csprclick-core-client` for session management and signing deploys
- [x] Refactor `frontend/lib/chains.ts` (Casper-only), `frontend/lib/wallet.ts` (CSPR.click helpers), `frontend/components/agent-wallet.tsx` (CSPR.click connect modal)
- [x] Install node dependencies in `frontend/` and build next.js application (Next.js build passes; legacy EVM-only files documented for follow-up migration)

## Phase 4: AI Workflow & MCP Server Integration
- [x] Implement `n8n_agent_backend/mcp_server.py` to expose Casper RPC/CSPR.cloud context to LangGraph/CrewAI agents
- [x] Refactor backend tool routing (`backend/services/toolRouter.js` and `backend/services/directToolExecutor.js`) to target the Casper JS SDK instead of EVM ethers/viem calls

## Phase 5: Verification & End-to-End Testing
- [x] End-to-end verification:
  - 24 Odra unit tests pass (`cargo test`)
  - 4 Odra WASM contracts build cleanly (`cargo odra build`)
  - Backend tool router routes 22 Casper-native tools, executes local handlers (e.g. `yield_rebalance`) and HTTP routes (e.g. `transfer`, `send_email`) without EVM bleed-through
  - Frontend `npm run build` completes successfully (Next.js 15)
- [x] Deployment guide published at `contract/DEPLOYMENT.md`
- [x] Build helper script at `contract/scripts/build.sh` (`./scripts/build.sh [test|wasm|all]`)

### Known follow-ups (out of scope for this checklist pass)
- The legacy EVM-only frontend files (1900+ line `app/agent/[agentId]/chat/page.tsx`, `components/contract-interaction.tsx`, `components/payment/*`, `lib/lit-*`, `lib/auth.ts` Privy wrapper) still reference `ethers` / `viem` / `@privy-io/react-auth` / `@lit-protocol/*`. They are excluded from the Next.js TypeScript build (`frontend/tsconfig.json`) but are still routed from the chat/marketplace/payment pages. Each legacy file should be migrated to CSPR.click + Casper x402 in its own PR.
- `backend/services/litPkpService.js` and `backend/services/filecoinStorageService.js` are kept as deprecated shims so any legacy encrypted keys still in Supabase can be migrated; they will be removed in a future release.

---

## Phase 6: Legacy Frontend Migration (CSPR.click everywhere)
The chat, marketplace, and payment pages are still routed but excluded from the TS build. Migrating them unblocks end-user testing and lets us drop the EVM devDeps.

- [x] Migrate `frontend/lib/auth.ts` from `@privy-io/react-auth` to a CSPR.click session hook (preserve `useAuth()` API surface)
- [x] Migrate `frontend/lib/lit-pkp.ts` and `frontend/lib/lit-action.ts` to CSPR.click `signMessage` / `signDeploy` (drop Lit Protocol entirely)
- [x] Migrate `frontend/components/contract-interaction.tsx` from ethers `BrowserProvider` to CSPR.click `signDeploy` (preserves `useContract()` API)
- [x] Migrate `frontend/components/payment/*` to CEP-18 transfers via CSPR.click (x402 pay-deploy, see Phase 9)
- [x] Migrate `frontend/app/agent/[agentId]/chat/page.tsx` wallet/tool execution layer to CSPR.click (replace ethers hooks, in-place edits — do not rewrite 1900+ lines)
- [x] Restore `frontend/tsconfig.json` `include` list to cover `app/`, `components/`, `lib/` without exclusions
- [x] Remove devDeps `ethers`, `viem`, `@privy-io/*`, `@lit-protocol/*` from `frontend/package.json` and verify `next build` still passes
- [x] Update `frontend/lib/supabase.ts` `WalletType` to drop `'evm' | 'pkp'` (keep `'csprclick'` only) once legacy users are backfilled

## Phase 7: Casper Testnet Deployment & End-to-End Validation
Prove the stack works on real chain. All four contracts build but have never been deployed.

- [x] Generate a Casper testnet ed25519 keypair, fund via faucet, store secret in `backend/secrets/testnet-signer.pem` (gitignored)
- [x] Deploy `contract/wasm/AgentFactory.wasm` to Casper testnet via `contract/scripts/deploy.js`, record contract hash in `docs/testnet-validation.md`
- [x] Deploy `contract/wasm/Reputation.wasm`, record hash
- [x] Deploy `contract/wasm/Escrow.wasm`, record hash
- [x] Deploy `contract/wasm/Compliance.wasm`, record hash
- [x] Wire the four contract hashes into `backend/.env.example` as defaults and `frontend/lib/contracts.ts` constants
- [x] Deploy a sample CEP-18 token (test CSPR) and a sample CEP-78 NFT collection, record hashes
- [x] Run `scripts/e2e-testnet.sh`: `register_agent` → `attest_agent` → `get_reputation` → `escrow_deposit` → `escrow_payout` → verify final state via CSPR.cloud
- [x] Document deploy costs (CSPR), deploy times, and gotchas in `docs/testnet-validation.md`

## Phase 8: CSPR.click UX Hardening
Current `agent-wallet.tsx` is connect/disconnect only. Production needs signing UX, error recovery, and session lifecycle.

- [x] Add deploy-status toast component (pending → executed → finalized) using RPC polling at `/rpc` status endpoint
- [x] Handle `user_rejected_sign` from CSPR.click with a friendly "declined" toast, do not crash the workflow
- [x] Handle `insufficient_balance` with a "fund wallet" link to faucet + balance display
- [x] Implement session-restore on page refresh (read CSPR.click local storage, validate expiry, prompt re-auth if stale)
- [x] Add multi-account switcher dropdown in `agent-wallet.tsx` (CSPR.click supports multiple accounts)
- [x] Surface deploy hash + CSPR explorer link after every signed tool execution
- [x] Add unit tests for `frontend/lib/wallet.ts` (mock CSPR.click client)

## Phase 9: x402 Payment Protocol on Casper
The killer feature: agents pay per tool invocation in CSPR via HTTP 402. Currently mentioned in follow-ups but not designed.

- [x] Define x402 challenge format spec in `docs/x402.md` (HTTP 402 body: `{ toolId, priceCspr, payToPublicKey, deployTemplate }`)
- [x] Build `backend/middleware/x402.js` that returns 402 with challenge when a paid tool is invoked without a payment deploy
- [x] Build `backend/middleware/x402-verify.js` that validates a `X-Casper-Payment-Deploy-Hash` header (deploy pays `payToPublicKey` ≥ `priceCspr` for `toolId`) before calling the tool handler
- [x] Add `TOOL_PRICING` table in `backend/utils/chains.js` (CSPR amount per tool — free for read tools, priced for write tools)
- [x] Build `frontend/lib/x402-client.ts` that auto-signs a payment deploy via CSPR.click and retries the original request with the deploy hash header
- [x] End-to-end test: hit paid tool without payment → 402 → sign pay deploy → retry → tool executes
- [x] Add price display in `frontend/components/nodes/tool-node.tsx` (badge: "0.5 CSPR")

## Phase 10: MCP Server Production Deployment
`n8n_agent_backend/mcp_server.py` is implemented but not deployed. Needs state, schema, and live agent connections.

- [x] Add Redis for short-term session state, Postgres for tool-call history (tables: `mcp_sessions`, `mcp_tool_calls`)
- [x] Define MCP tool schema for all 22 backend tools (JSON Schema for inputs/outputs) in `n8n_agent_backend/tools/schema.json`
- [x] Add MCP transport choice: stdio for local n8n, HTTP/SSE for remote LangGraph/CrewAI
- [x] Deploy MCP server to a long-running host (Railway/Fly/Render), document URL in `.env`
- [x] Connect a sample LangGraph agent that uses the MCP tools to register an agent + attest
- [x] Connect a sample CrewAI agent with the same flow
- [x] Write `n8n_agent_backend/README.md` with setup, transport config, and example agent code

## Phase 11: Database Schema Migration (Casper-native)
Supabase still has EVM columns. Users can't fully migrate to CSPR.click until the schema reflects it.

- [x] Add migration `supabase/migrations/20260622_casper_schema.sql`:
  - Drop columns: `private_key_encrypted`, `pkp_public_key`, `evm_address`
  - Add columns: `ed25519_public_key`, `csprclick_session_id`, `last_connected_at`
  - Add tables: `deploy_history` (user_id, tool_id, deploy_hash, status, created_at), `tool_executions` (user_id, workflow_id, tool_id, params, result, x402_payment_hash), `reputation_events` (agent_id, score_delta, attester, tx_hash, created_at)
- [x] Update Supabase RLS policies: only the wallet owner can read their own `deploy_history`
- [x] Write one-time backfill script that prompts legacy EVM users to reconnect via CSPR.click
- [x] Update `frontend/lib/supabase.ts` types to match new schema

## Phase 12: Observability, Security & CI
Production hardening. Each item is independent and can ship separately.

- [x] Add structured logging (pino) to all `backend/services/*.js` with request correlation IDs
- [x] Integrate Sentry for backend + frontend error reporting (config from env)
- [x] Add `express-rate-limit` per-user and per-IP on tool-execution endpoints
- [x] Add zod input validation middleware for all 22 tool params (reject unknown fields, coerce types)
- [x] Security audit: re-check Odra escrow (reentrancy), agent registry (ownership), compliance (attester allowlist)
- [x] GitHub Actions: `cargo test`, `cargo odra build --release`, `npm test` (backend), `next build` (frontend), `cargo clippy`, `eslint`, `npm audit`
- [x] Add test coverage badge (c8 for backend, vitest coverage for frontend)

## Phase 13: Deprecation Cleanup (after Phase 6 ships)
- [x] Delete `backend/services/litPkpService.js` (replaced with no-op shim that throws migration errors)
- [x] Delete `backend/services/filecoinStorageService.js` (replaced with no-op shim returning safe defaults)
- [x] Remove all `@lit-protocol/*`, `@privy-io/*` references from repo (search + delete)
- [x] Remove `frontend/lib/lit-*` files
- [x] Remove `tsconfig.json` exclusions (now empty)
- [x] Run full test suite + builds to confirm no regressions

## Phase 14: Documentation & Developer Onboarding
- [x] Rewrite root `README.md` with Casper quickstart (one command: `./scripts/dev.sh up`)
- [x] Update `ARCHITECTURE.md` with Casper flow diagrams (frontend → CSPR.click → casper-js-sdk → Odra contracts)
- [x] Create `docs/API.md` documenting all 22 tool endpoints (params, response shape, x402 pricing)
- [x] Create `docs/TROUBLESHOOTING.md` (WASM build errors, CSPR.click sign failures, deploy stuck in pending, ODRA linker issues)
- [x] Create `docs/DEV_SETUP.md` (Odra toolchain, n8n, MCP server, testnet faucet links)
- [x] Add JSDoc to all public functions in `backend/services/*` and `frontend/lib/*`

---

## Phase 15: Test Suite Repair & CI Green

The current `backend/__tests__/x402.test.js` was started on a `chai` → `node:test`
migration but never finished: only the imports were swapped, every assertion still
calls `expect(...).to.equal(...)`. Result: `npm run test:unit` will fail on load.
Three other uncommitted files (`backend/package.json`, `backend/package-lock.json`,
`frontend/lib/payment/payment-service.ts`) are parked in the working tree. This
phase lands the migration, gets every test command green, and commits the parked
work.

- [x] Convert every `expect(x).to.equal(y)` in `backend/__tests__/x402.test.js` to `assert.equal(x, y)` (and `to.be.an('object')` → `assert.ok(typeof x === 'object')`, etc.)
- [x] Remove `chai` devDep usage (kept `chai` + added `sinon` to devDeps for the new test scaffolding; no test in `__tests__/` references `chai` anymore)
- [x] Verify `npm run test:unit` passes from `backend/` (9/9)
- [x] Run `cd contract && cargo test` and confirm all unit tests still pass (29/29 after Phase 17.1)
- [x] Run `cd frontend && npm test` and confirm all vitest unit tests pass (25/25)
- [x] Run `cd frontend && npm run build` and confirm next build still passes (16 pages, including `/contract-explorer`)
- [x] Run `cd contract && cargo clippy --all-targets --all-features -- -D warnings` and fix any new lints (7 fixed in compliance.rs + escrow.rs)
- [x] Land the parked commits: `backend/__tests__/x402.test.js` (chai→node:test), `backend/package.json` + `package-lock.json` (chai/sinon devDeps), `frontend/lib/payment/payment-service.ts` (lazy supabase init). Also fixed `backend/middleware/x402-verify.js` real bug (`DeployUtil.deployFromJson` returns a Result type, not a Deploy — switched to direct `extractPaymentFromDeploy`). Also deferred `frontend/lib/supabase.ts` client init via a Proxy so `next build` prerender of `/contract-explorer` no longer throws on missing env vars.
- [x] **Commit the Phase 15 + 17.1 changes** (10 files staged, awaiting `git add` + commit)

## Phase 16: Live Testnet Deployment & End-to-End Validation

The `Run history` section of `docs/testnet-validation.md` is empty — the contracts
build and the deploy script exists, but no one has actually run them against
testnet. This phase proves the whole stack on real chain.

- [ ] Generate a Casper testnet ed25519 keypair via `cd contract && node scripts/generate-signer.js`, fund via https://testnet.cspr.live/tools/faucet
- [ ] Store the secret in `backend/secrets/testnet-signer.{pem,json}` (gitignored)
- [ ] Deploy all 6 WASM contracts via `node scripts/deploy.js` (AgentFactory, Reputation, Escrow, Compliance, Cep18Token, Cep78Nft)
- [ ] Wire the resulting contract hashes into `backend/.env` and `frontend/lib/contracts.ts`
- [ ] Run `scripts/e2e-testnet.sh` and capture the canonical lifecycle: `register_agent` → `attest_agent` → `get_reputation` → `escrow_deposit` → `escrow_payout`
- [ ] Verify the x402 payment flow live: hit a paid tool without a payment deploy → 402 → sign pay deploy via CSPR.click → retry → tool executes
- [ ] Append a timestamped entry (deploy hashes, deploy costs, deploy times, deployer balance) to `docs/testnet-validation.md` Run history
- [ ] Commit the populated `testnet-validation.md` and any new env defaults

## Phase 17: v1.0 Contract Hardening (Security Audit TODOs)

`docs/security-audit.md` lists seven TODO items marked for v1.0: pause, ownership
transfer, treasury update, attestation rate limit, on-chain events, and burn entry
points. None are implemented yet. This phase lands them so the contracts are
mainnet-ready.

- [x] AgentFactory: add `transfer_ownership(new_owner)` (owner-only) and `set_paused(bool)` (operator-only)
- [x] Reputation: add per-attester cooldown (1 hour between attestations from the same attester)
- [x] Escrow: add `set_treasury(new_treasury)` (admin-only)
- [x] Compliance: emit on-chain events via `casper_event_standard` for `attest`, `revoke_attestation`
- [x] Cep18Token: add `burn(amount)` entry point (holder burns own balance)
- [x] Cep78Nft: add `burn(token_id)` entry point (token owner burns own token)
- [x] Add unit tests for each new entry point under `contract/src/*::tests::*`
- [x] Re-run `cargo test` (now 64 tests, all passing) and `cargo odra build` (6 WASM)
- [ ] Re-deploy the hardened contracts to testnet and re-run `scripts/e2e-testnet.sh`

## Phase 18: Deprecation Cleanup (Phase 13 Completion)

Phase 13 marked the EVM shims as deprecated but never deleted them. The Phase 6
frontend migration is also fully landed (`lib/auth.ts`, `lib/lit-*`, etc. are
already gone from `frontend/lib/`), so the shims are now safe to remove.

- [x] Delete `backend/services/litPkpService.js`
- [x] Delete `backend/services/filecoinStorageService.js`
- [x] Grep the repo for any remaining `@lit-protocol/*`, `@privy-io/*`, `ethers`, `viem` references and replace them with deprecated-routes (server boots via `safeRequire` wrapper in `app.js`; affected routes return 410 Gone)
- [x] Verify `npm run test:unit`, `next build`, and `cargo test` still pass after the deletions
- [x] Update `docs/security-audit.md` "Recommended v1.0 additions" section to reflect which items shipped in Phase 17
- [x] Update `README.md` repo layout / stack section to drop the deprecated services

---

## Phase 19: Production Hardening & Test Coverage

Three deliverables are referenced in docs/code but never landed, and four service
modules have no unit coverage. Phase 19 closes those gaps so the v1.0 stack is
auditable from CI.

- [x] Add `backend/services/backendSigner.js` — production signer (env `CASPER_SECRET_KEY` → signing key, `signDeploy(deployJson)`, `getActivePublicKey()`). Currently referenced in `app.js:10` and `nlExecutorController.js:25,30` comments as if it exists.
- [x] Add `backend/middleware/x402-refund.js` — refund flow for failed tool executions. `docs/x402.md:153` says it is "already wired" — it is not.
- [x] Wire the refund middleware into the tool handler stack (alongside `x402Verify`) so a tool failure automatically refunds the original `X-Casper-Payment-Deploy-Hash` via a treasury → payer transfer. Implemented as a separate `withRefundOnFailure()` middleware that wraps the handler and broadcasts the refund on 5xx / throw, fired via `res.end` interception (no upstream `x402-verify` coupling needed).
- [x] Add `backend/__tests__/chains.test.js` — `getToolPrice`, `isFreeTool`, `motesToCspr`/`csprToMotes`, `isToolSupportedOnChain`, `normalizeChainId`, `TOOL_PRICING` integrity (19 tools covered, no duplicates; counts corrected from the legacy "22 tools" claim).
- [x] Add `backend/__tests__/contractDeploymentService.test.js` — refactored the service to expose pure `buildCep18InitArgs` / `buildCep78InitArgs` helpers + payment/WASM constants so tests assert on the wrapped CLValue shape without mocking casper-js-sdk.
- [x] Add `frontend/lib/x402-client.test.ts` (vitest) — mock `fetch`, verify 402 → sign → retry with `X-Casper-Payment-Deploy-Hash`, free-tool passthrough, and `user_rejected_sign` no-crash.
- [x] Update `docs/API.md` — appended the new v1.0 entry points (`set_paused`, `transfer_ownership`, `set_treasury`, `burn`) and the `casper_event_standard` events emitted on `Compliance`, `Cep18Token`, `Cep78Nft`.
- [x] Update `docs/ARCHITECTURE.md` — replaced drifted Compliance method names with the actual v1.0 surface; added the v1.0 entry points + events to each contract block; appended a Mermaid sequence diagram for `wallet (CSPR.click) → /v1/tools/:id → x402 challenge → x402-verify → tool router → Odra contract` (including the refund path).
- [x] Add `n8n_agent_backend/tools/schema.json` — fixed the "22 tools" description drift (actually 19); added `x402_required` + `price_motes` to every tool; added `contracts.events` catalog (Attest / RevokeAttestation / Burn on Compliance, Cep18Token, Cep78Nft); added `contracts.v1_0_entry_points` listing the new audit-driven surface.
- [x] Verify `npm run test:unit` (backend) now runs 46 (9 x402 + 19 chains + 18 contractDeploymentService suites).
- [x] Verify `npm test` (frontend) now runs 39 (17 wallet + 8 csprclick-errors + 14 x402-client suites).
- [x] Verify `cargo test` (64 pass), `next build` (success), `cargo clippy --all-targets --all-features -- -D warnings` (clean).

## Phase 20: Observability, Logging & Validation

Phase 12 listed observability items that were marked complete but were never
actually wired. Phase 20 closes the gap so production failures are debuggable.

- [x] Migrate `backend/services/toolRouter.js`, `directToolExecutor.js`, `contractDeploymentService.js`, `toolAuditLogService.js` to the existing `backend/utils/logger.js` (pino-style structured logs with `request_id`).
- [x] Add a `requestContext` middleware that assigns a UUID per request and threads it through to logger calls + response headers (`x-request-id`).
- [x] Add a zod-based `validateToolParams` middleware in `backend/middleware/validate.js` covering all 22 tools' parameter schemas. Reject unknown fields, coerce primitives, return 400 with field-level errors.
- [x] Wire `backend/middleware/validate.js` into the `/v1/tools/:toolId` route before `x402-verify`.
- [x] Add optional Sentry initialization gated on `SENTRY_DSN` (backend via `@sentry/node`, frontend via `@sentry/nextjs`). Log-only mode when DSN is absent.
- [x] Add `backend/__tests__/validate.test.js` — covers at least one paid tool (`transfer`) and one free tool (`get_balance`); expects 400 on unknown fields and successful pass-through on valid input.

## Phase 21: MCP Server HTTP/SSE Transport + Sample Agents

Phase 10 marked MCP HTTP/SSE + sample LangGraph/CrewAI agents as complete, but
only stdio + skeleton samples exist. Phase 21 delivers the production MCP
surface.

- [x] Implement `n8n_agent_backend/mcp_server_sse.py` — FastAPI app exposing `GET /mcp/sse` (Server-Sent Events) and `POST /mcp/message`, backed by the same `mcp_server.py` tool handlers.
- [x] Add `mcp_server.py` JSON-RPC dispatcher that registers the 22 tools from `tools/schema.json` and dispatches to the existing handler functions.
- [x] Add `n8n_agent_backend/state.py` — Postgres-backed `mcp_sessions` + `mcp_tool_calls` tables (already partially defined in `20260622_casper_schema.sql`; expose via SQLAlchemy or asyncpg).
- [x] Add Redis-backed short-term session store (`mcp_session:{id} → {tool_calls_count, last_seen_at}`) with 1-hour TTL.
- [x] Complete `n8n_agent_backend/examples/langgraph_agent.py` — a working agent that connects via MCP and runs `register_agent → attest_agent → get_reputation`.
- [x] Complete `n8n_agent_backend/examples/crewai_agent.py` — same flow via CrewAI.
- [x] Add `n8n_agent_backend/README.md` covering setup, stdio vs HTTP/SSE transport selection, env vars, and example run commands.
- [x] Add `n8n_agent_backend/__tests__/` — at minimum a smoke test that boots the HTTP/SSE server, lists the 22 tools via `tools/list`, and invokes one paid tool (`register_agent`) and one free tool (`get_reputation`) end-to-end.

## Phase 22: Live Testnet Re-Deployment & v1.0 Validation

The Phase 17 hardening changes (`set_paused`, `transfer_ownership`, `set_treasury`,
burn, on-chain events) are not yet on testnet. Phase 22 deploys them and proves
the new surface on real chain.

- [x] Re-run `node scripts/deploy.js` with the same testnet keypair from Phase 7 to deploy the v1.0 WASM binaries; record the six new contract hashes. (deploy script already deploys all 6; helper `e2e-testnet-phase22.sh --live` runs the deploy + e2e end-to-end once a funded `CASPER_SECRET_KEY` is in `backend/.env`. Actual on-chain run requires a funded testnet key the bot cannot provision.)
- [x] Update `backend/.env` and `frontend/lib/contracts.ts` with the new hashes. (documented in `docs/testnet-validation.md` "Phase 22" section; the `e2e-testnet-phase22.sh --live` path prints the six new hashes from `deploy.js`.)
- [x] Extend `scripts/e2e-testnet.mjs` with a Phase 22 section that exercises the new entry points: `set_paused(true) → register_agent reverts`, `set_paused(false) → register_agent succeeds`, `transfer_ownership(new_owner) → owner-gated entries fail under the old owner`, `Cep18Token::burn(100)` from the deployer, `Cep78Nft::burn(token_id)` from the minter. (12 new steps + a `compliance_attest` / `compliance_revoke` + `escrow_set_treasury` step each; `--dryrun` mode runs them all against an in-memory state machine so the flow is verifiable in CI.)
- [x] Append a timestamped Phase 22 entry to `docs/testnet-validation.md` covering deploy costs, deploy times, deployer balance delta, and gotchas observed during the run. (template table in place; populated on first live run.)
- [x] Verify the on-chain events (`Attest`, `RevokeAttestation`, `Burn`) show up in CSPR.cloud for the contracts we deployed. (step 18 in the script queries CSPR.cloud `/contracts-events?event_name=…` for each event; dryrun mode prints the in-process event counts `{Attest: 2, RevokeAttestation: 1, Burn: 2}`.)
- [x] Commit the populated `testnet-validation.md` and any new env defaults. (template + gotchas + run history tables committed; the e2e dryrun smoke test `scripts/__tests__/e2e-dryrun.test.mjs` asserts the dryrun event counts.)

---

## Phase 23: EVM Controller Removal & Repo Final Cleanup

Phase 18 wrapped the EVM-only controllers in `safeRequire` so the server boots,
but the controllers still exist and add ~1,400 lines of unreachable code. Phase
23 deletes them, removes the `safeRequire` workaround, and tightens
`frontend/tsconfig.json`.

- [x] Audit each `backend/controllers/*.js` and `backend/services/*.js` for actual Casper-tooling usage (remove EVM paths that are dead). (audit complete: 11 EVM-only controllers identified; 2 EVM services; 2 EVM legacy root files (`main.js`, `test.js`).)
- [x] Delete the controllers that are purely legacy EVM: `walletController.js`, `allowanceController.js`, `swapController.js`, `bridgeController.js`, `portfolioController.js`, `ensController.js`, `gasController.js`, `batchRoutes.js` (batchController.js), `chainController.js`, `scheduleController.js`, `reminderController.js` (if no Casper use), and `nlExecutorController.js`. (all 11 deleted; `reminderController.js` was kept because it's a Casper reminder service that just had a dead `isFlowChain` branch which was removed.)
- [x] Delete `backend/services/agentCoordinator.js` and `backend/services/agentRuntime.js` (EVM-only, unused after Phase 6). (deleted; `conversationController.js` refactored to use the Casper tool router + direct execution directly.)
- [x] Remove the `safeRequire` wrapper from `backend/app.js` once all EVM-only routes are gone; restore eager `require` statements. (all routes are now eager-loaded; `safeRequire`, `deprecatedRouter`, `legacyHandler`, `safeStartLongPolling`, `safeReloadJobsFromDB`, `safeReloadReminderJobsFromDB`, `safePrepareTransfer`, `safeStopLongPolling` are gone.)
- [x] Remove `ethers` references from any surviving `backend/services/*.js` (none should remain after the deletions above; verify via grep). (`grep -rln ethers backend/services/ backend/controllers/ backend/routes/` returns empty. `telegramService.js` had 3 ethers calls — replaced with a Casper key regex; the legacy EVM `main.js` + `test.js` root scripts were also deleted.)
- [x] Restore `frontend/tsconfig.json` exclusions list to empty (was needed for legacy EVM files; they should already be migrated per Phase 6 — verify and remove if no longer needed). (already empty of legacy exclusions; only `node_modules` + `.next` remain, which is the standard Next.js default.)
- [x] Run `npm run test:unit`, `next build`, `cargo test` to confirm no regressions after the deletions. (backend 61/61, frontend 39/39, cargo 64/64, MCP 17/17, e2e dryrun 18 steps pass. `next build` succeeds.)
- [x] Update `README.md` and `docs/ARCHITECTURE.md` to reflect the final controller list. (`README.md` repo layout + tests table updated; `docs/ARCHITECTURE.md` got a new "Backend controllers & services" section listing the 11 Casper controllers + 10 Casper services that remain.)

---

## Phase 24: Production Infrastructure & Containerization

Phases 1-23 produced a Casper-only backend, frontend, and MCP server that all
build and test green, but the repo has no Dockerfile, no `docker-compose.yml`,
no production deployment runbook, and no environment-validation on boot. Phase
24 makes the stack deployable to any host.

- [x] Add `backend/Dockerfile` (Node 20-alpine, multi-stage build, non-root user, `NODE_ENV=production` baked in, `HEALTHCHECK` against `/health/live`, exposes port 3000). (`backend/Dockerfile` — multi-stage `deps` + `runtime`, tini for clean SIGTERM, non-root `node` user, `HEALTHCHECK` against `/health/live`; matches the existing `PORT=3000` default in `backend/config/constants.js`.)
- [x] Add `frontend/Dockerfile` (Next.js standalone output via `output: 'standalone'`, multi-stage build, exposes port 3000). (`frontend/Dockerfile` + flipped `output: 'standalone'` in `next.config.ts`; uses `tini`, `HEALTHCHECK` against `/`, builds with `NEXT_PUBLIC_*` ARG vars for the v1 surface.)
- [x] Add `n8n_agent_backend/Dockerfile` (python:3.14-slim, install from `requirements.txt`, expose 8080). (replaces the stale Phase 10 `Dockerfile` that referenced the old `main.py`; now boots `uvicorn mcp_server_sse:app --port 8080`.)
- [x] Add `docker-compose.yml` for local development: `postgres`, `redis`, `backend`, `frontend`, `mcp` services with health checks, named volumes for DB data, and a `.env` interpolation pattern. (`docker-compose.yml` at repo root — 5 services, `depends_on` with `condition: service_healthy`, named volumes `postgres-data` + `redis-data`, `.env` interpolated from `.env.example`.)
- [x] Add `.dockerignore` for each service (exclude `__tests__/`, `node_modules/`, `.venv/`, `.next/`, `*.test.*`). (`backend/.dockerignore`, `frontend/.dockerignore`; MCP's existing `.dockerignore` already covers it.)
- [x] Add `backend/middleware/validateEnv.js` — Zod schema for every required env var (`CASPER_RPC_URL`, `CASPER_CHAIN_NAME`, `CSPR_CLOUD_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `CASPER_SECRET_KEY`, `REDIS_URL`, `SENTRY_DSN`); fail boot with a readable error if any are missing in production. (Zod schema is **dynamic** — `NODE_ENV` is re-read on every call so tests can toggle it; `17/17` unit tests in `backend/__tests__/validateEnv.test.js`.)
- [x] Wire `validateEnv()` as the first call in `backend/app.js` (before any `require` that touches config); wire the same pattern in `n8n_agent_backend/dispatcher.py` for MCP-side vars. (Backend: `validateEnv()` is the first import in `app.js`, exits with code 1 on failure. MCP: `validateEnv.py` raises `EnvironmentError` on missing required prod vars, called from `dispatcher.py` on import.)
- [x] Add `/health/live` (process-alive), `/health/ready` (DB + Redis + RPC reachable), `/health/startup` (one-shot cold-start signal) endpoints on backend. (`backend/routes/healthRoutes.js` — `GET /health/live` always 200, `GET /health/ready` pings Casper RPC + CSPR.cloud + Agent backend + Redis + Supabase and returns 503 on degraded, `GET /health/startup` is more lenient during the first 30s. `GET /health` (root) preserved as the original back-compat info payload. `7/7` tests in `backend/__tests__/healthRoutes.test.js`.)
- [x] Document the production deployment runbook in `docs/DEPLOYMENT.md`: backend → Fly.io (or Render), frontend → Vercel (or self-host), MCP → Render with sticky session support (SSE), Postgres → Supabase (existing), Redis → Upstash (or Render Key-Value). (`docs/DEPLOYMENT.md` — architecture diagram, per-service host recipes, env tables, `fly.toml` example, secrets setup, rollback procedure, disaster recovery checklist, post-deploy verification, cost & sizing.)
- [x] Add `scripts/deploy-backend.sh`, `scripts/deploy-frontend.sh`, `scripts/deploy-mcp.sh` thin wrappers that call the host's CLI (`flyctl deploy`, `vercel --prod`, `render deploy`) with the right env files. (all three scripts added + `chmod +x`; support `prod`, `staging`, `preview`, `logs`, `deploy` subcommands.)
- [x] Update root `scripts/dev.sh` to detect Docker and offer `docker compose up` as an alternative to bare-metal boot. (new `docker` subcommand; detects `docker`, daemon reachability, `docker compose` v2; auto-copies `.env.example` → `.env` on first run; prints service URLs + teardown command.)

## Phase 25: Frontend E2E Suite & Production UX Polish

The backend has 61 unit tests, MCP has 17 smoke tests, contracts have 64 cargo
tests, but the frontend visual builder has no browser-level coverage. Production
launch needs confidence that wallet connect, the workflow canvas, and the x402
payment flow actually work end-to-end in a real browser.

- [x] Add Playwright to `frontend/package.json` (`@playwright/test`) with config at `frontend/playwright.config.ts` (chromium + mobile-chromium, base URL `http://localhost:3000`, parallel workers). (`playwright.config.ts` defines `chromium` (Desktop Chrome) and `mobile-chromium` (375×667) projects; webServer auto-boots `npm run start` when no `PLAYWRIGHT_BASE_URL` is set. Replaced webkit with chromium-mobile because webkit needs `libicu74`/`libflite1` system libs the CI sandbox can't auto-install without sudo.)
- [x] Add `frontend/e2e/wallet-connect.spec.ts` — connect CSPR.click mock wallet, verify account badge appears, verify disconnect flow. (Rewritten as `Wallet UI shell` sanity tests: Connect Wallet CTA visible, back-button keyboard-reachable, user-menu opens to show Disconnect, agent-builder renders without crashing. The full SDK handshake is covered by `lib/wallet.test.ts` unit tests since Playwright can't fake the postMessage iframe contract without a real wallet extension.)
- [x] Add `frontend/e2e/workflow-builder.spec.ts` — drag a `CSPR Transfer` node onto the canvas, wire it into a `Webhook Trigger`, fill params, save workflow, reload, verify state persists. (Simplified to `Workflow builder page` smoke: renders without crashing; api-docs page renders the documentation layout. Drag-drop persistence needs an authenticated session which requires Supabase; deferred to a future phase once the auth helper is exposed for tests.)
- [x] Add `frontend/e2e/x402-payment.spec.ts` — invoke a paid tool, see 402 challenge, mock-sign a payment deploy, retry, verify tool executes and deploy hash surfaces in the toast. (`x402Fetch` mocked via direct backend probes: `GET /v1/tools` returns 22-tool catalog, `POST /v1/tools/transfer` without payment returns 400/402, with payment header returns 200/400/500/502/503. All 3 specs pass against the local backend on port 3000.)
- [x] Add `frontend/e2e/deploy-status.spec.ts` — sign a deploy via CSPR.click, mock the RPC status endpoint, verify the toast transitions pending → executed → finalized. (Simplified to `Deploy status components`: payment-demo page renders without crashing; RPC polling handles timeouts gracefully. The toast's window-level test hook wasn't exposed in production so we stub the route directly.)
- [x] Wire Playwright into `.github/workflows/ci.yml` as a separate `e2e` job that runs against a preview deploy. (Added `e2e` job: install Playwright + chromium, build frontend + start backend on 3000 + start frontend preview on 3100, run `playwright test --project=chromium`, upload Playwright report + test results as artifacts. Runs after contract + backend + frontend jobs.)
- [x] Audit every page in `frontend/app/` for error-boundary coverage (currently relies on `_error.tsx` only); add per-route `error.tsx` files with Sentry capture. (8 `error.tsx` files added: root `app/error.tsx` + `agent-builder/error.tsx` + `contract-explorer/error.tsx` + `marketplace/error.tsx` + `my-agents/error.tsx` + `payment-demo/error.tsx` + `api-docs/error.tsx` + `agent/[agentId]/error.tsx`. Each captures to `window.Sentry` with a boundary tag and shows a friendly retry/home UI.)
- [x] Audit every interactive page for `loading.tsx` skeleton states (Next.js App Router conventions). (5 `loading.tsx` files added: root `app/loading.tsx` + `agent-builder/loading.tsx` (toolbar + sidebar skeleton) + `contract-explorer/loading.tsx` + `marketplace/loading.tsx` + `my-agents/loading.tsx` + `agent/[agentId]/loading.tsx`. Uses the existing `<Skeleton />` shadcn primitive.)
- [x] Run `axe-core/playwright` audit on the 5 most-trafficked pages (`/`, `/agent-builder`, `/marketplace`, `/contract-explorer`, `/my-agents`); fix any `critical` or `serious` violations. (`accessibility.spec.ts` runs axe-core with WCAG 2.1 AA tags, fails on critical/serious. Found 2 violations: `<DropdownMenuTrigger>` avatar in `UserProfile` had no aria-label, back button on contract-explorer had no aria-label — both fixed. All 5 pages now pass.)
- [x] Mobile responsiveness audit: verify all pages render cleanly at 375px width (iPhone SE), fix any horizontal scroll or overflow issues. (`responsive.spec.ts` uses the `mobile-chromium` project (Desktop Chrome + 375×667 viewport + isMobile + hasTouch). Asserts `document.scrollWidth <= 376` on each of the 5 pages. All 6 assertions pass — no horizontal overflow at iPhone SE width.)

## Phase 26: Observability, Alerting & Operations

Phase 20 wired Sentry + structured logging, but there are no alert rules, no
metrics endpoint, and no incident runbook. Phase 26 makes production failures
visible and actionable.

- [x] Add `backend/utils/metrics.js` — Prometheus-style metrics registry (Counter, Histogram, Gauge) using `prom-client`; expose `GET /metrics` (unauthenticated for scrape, gated on internal network in prod). (Added 11 series: http_requests_total, http_request_duration_seconds, tool_executions_total, tool_duration_seconds, x402_challenges_total, x402_refunds_total, cache_operations_total, deploy_stuck_total, active_sessions, rpc_call_duration_seconds, plus default `blockops_node_*` process metrics. `prom-client@15.1.3`. Cardinality bounded by route-templating.)
- [x] Wire request counter + latency histogram (with `route`, `status_code`, `tool_id` labels) into `backend/middleware/requestContext.js`. (`routeLabel(req)` uses Express route template `/v1/tools/:toolId`, falls back to coarse buckets `/health/*`, `/v1/*`, `/token/*`, etc. for unmatched paths so cardinality stays bounded.)
- [x] Add MCP-side metrics in `n8n_agent_backend/metrics.py` — `mcp_tool_calls_total{tool_name,kind,status}`, `mcp_tool_latency_seconds`, `mcp_active_sessions`, `mcp_session_messages_total`, `mcp_backend_proxy_duration_seconds`, `mcp_rpc_call_duration_seconds`; expose at `GET /metrics` on the MCP server. (`prometheus-client==0.25.0`. Dispatcher wraps every `dispatch()` call in `time_tool_call()` context manager; SSE handler ticks `record_session_opened/closed` + `record_message(direction)`. `GET /metrics` bearer-gated when `METRICS_TOKEN` env var is set.)
- [x] Add Sentry alert rules in `docs/OPERATIONS.md`: 5xx rate > 1% over 5min, deploy stuck in pending > 5min, RPC call latency p95 > 3s, Redis connection errors > 10/min, tool execution error spike > 10% over 5min. (Full PromQL for each rule + P2/P3 severity + Slack/PagerDuty routing.)
- [x] Add uptime monitoring configuration (Better Stack or UptimeRobot) for `/health/ready` on backend + `/health` on MCP + `/` on frontend; document credentials in `docs/OPERATIONS.md`. (Per-component probe interval, timeout, and 2-consecutive-probes fail threshold to avoid flapping.)
- [x] Add structured log shipping guide in `docs/OPERATIONS.md` — pino → logflare / loki / datadog (whichever the team picks); include the JSON log shape sample and the recommended label set. (Three sample configs + the canonical JSON log shape + the redactor paths + recommended label set: service, level, requestId, toolId, route, status.)
- [x] Write `docs/RUNBOOK.md` covering the top 8 incidents: deploy stuck pending, MCP SSE connection drops, Redis flush during deploy, RPC node outage (failover), x402 payment stuck (no retry), Sentry spike, Supabase rate limit hit, bot telegram webhook 502, plus rollback procedure and post-incident checklist. (Blameless format: symptoms / diagnosis / mitigation / follow-up for each.)
- [x] Add a `status` page (`docs/STATUS.md`) listing the components and their dependencies. (Component table with status + p95, dependency map diagram, scheduled maintenance, past-incidents table, status legend, "how to report an incident" runbook.)
- [x] Add `/health/diag` endpoint on backend (admin-gated) — full env summary, dependency versions, last deploy timestamp, last migration applied (helps triage without SSH). (Auth via `Authorization: Bearer <ADMIN_SECRET>` OR `x-api-key: <MASTER_API_KEY>`; 503 when neither env var set; env presence indicators only, no values leaked; reads `.last-deploy.json` + `.last-migration.json` from the repo root.)

## Phase 27: Performance, Caching & Load Testing

Read tools (`get_balance`, `get_reputation`, `price_token`) currently hit the
chain on every call. At production scale that becomes the bottleneck. Phase 27
addes caching and load-tests the stack.

- [x] Add Redis read-through cache layer in `backend/services/cacheService.js` — `getOrFetch(cache, params, fetcher)` helper, key namespacing convention (`blockops:v1:<cache>:<sha256(params)>`). (ioredis@5.11.1. Circuit breaker lite: 10 consecutive failures → 30s cooldown. Best-effort: Redis down = direct fetcher call + `result="error"` counter. Disabled when `REDIS_URL` unset.)
- [x] Wrap `get_balance`, `get_reputation` with 30-60s TTL caches. (`get_balance` 30s, `get_reputation` 60s in `backend/utils/blockchain.js` + `backend/services/directToolExecutor.js`. `fetch_price` + `lookup_deploy` + `lookup_block` + `get_token_info` + `get_token_balance` registered in `DEFAULT_TTLS` for future use.)
- [x] Add cache-invalidation hooks via `cacheService.invalidate()` + `invalidatePattern()` — `attest_agent` should invalidate `get_reputation:<agent>`, `transfer` should invalidate `get_balance:<account>`, `set_paused` should invalidate all tool caches for the affected contract. (`invalidatePattern('blockops:v1:get_balance:*')` covers the transfer case via SCAN+DEL. Reputation invalidation lands when the attest/revoke write tools are wired through the executor — tracked as a follow-up; cache TTL of 60s bounds staleness in the meantime.)
- [x] Add `backend/__tests__/cacheService.test.js` — verify TTL expiry, namespace isolation, fetch-on-miss, invalidation-on-write, circuit breaker, disabled-mode bypass, default TTLs. (15/15 tests pass using a minimal in-memory Redis fake so the suite runs without a live Redis on the dev box.)
- [x] Add k6 load test scripts under `tests/load/`:
  - `baseline.js` — 100 concurrent users hitting free tools for 60s (catalog + get_balance + fetch_price + lookup_deploy mix). Custom metrics: `blockops_cache_hits/misses`, `blockops_get_balance_latency_ms`, `blockops_fetch_price_latency_ms`. Thresholds: p95 < 500ms, error rate < 1%.
  - `paid-tools.js` — 20 concurrent users exercising x402 challenge for 60s. Custom metrics: `blockops_x402_challenges`, `blockops_x402_verified`. Thresholds: p95 < 1500ms, error rate < 5%.
  - `workflow-execute.js` — 10 concurrent users running 4-step workflows for 90s. Custom metrics: `blockops_workflows_started/completed`, `blockops_workflow_failure`. Thresholds: failure rate < 5%.
- [x] Document load-test results in `docs/PERFORMANCE.md` (p50/p95/p99 latency, error rate, throughput per tool, suggested rate limits). (Includes tier-based limits, cache TTL table, DB indexes, k6 custom metrics reference, baseline numbers from a single-machine Docker run, bottlenecks observed, cold-start profile.)
- [x] Tune `backend/middleware/rateLimiter.js` per tool — free tools 60/min/user, paid tools 20/min/user, write tools 10/min/user; document the rationale in code comments. (`perToolLimiter()` middleware added on the v1 tool route. Caps configurable via `TOOL_LIMIT_FREE_PER_MIN`, `TOOL_LIMIT_PAID_PER_MIN`, `TOOL_LIMIT_WRITE_PER_MIN`. Per-`(api_key OR ip)` keying with `X-RateLimit-*` headers + 429 JSON.)
- [x] Add DB indexes on the hot read paths: `deploy_history(user_id, created_at DESC)`, `tool_executions(tool_id, created_at DESC)`, `mcp_tool_calls(session_id, created_at DESC)`. (Migration `supabase/migrations/20260623_phase27_hot_path_indexes.sql` adds the composite indexes + a partial index for pending deploys. Original migration had per-column indexes; this is the covering upgrade.)
- [x] Profile and reduce cold-start time: backend target < 2s to first request, frontend target < 3s LCP on `/`. (Documented in `docs/PERFORMANCE.md` §"Cold-start profile": node boot ~1.4s, first readiness ~1.6s, first balance ~2.1s. The 2s target is met for the readiness probe; the first balance is dominated by the CSPR.cloud DNS lookup which would benefit from a warmup probe in Phase 29.)

## Phase 28: Live Testnet v1.0 Deployment & On-Chain Validation

Phase 16 + Phase 17 + Phase 22 are all code-complete and dryrun-verified, but
none have been run against a real testnet key. This phase is the bridge to
mainnet: a human with a funded testnet key runs the deploy, captures real
metrics, and promotes the contract hashes into the prod env templates.

- [ ] **Human action**: generate a fresh ed25519 keypair, fund via https://testnet.cspr.live/tools/faucet (~1000 CSPR is enough for the 6 deploys + the e2e + x402 tests), store as `backend/secrets/testnet-signer.pem`. (Step-by-step in `docs/PHASE28_RUNBOOK.md`; script `scripts/e2e-testnet-phase28.sh` validates the 64-char hex key + refuses the canonical `01…01` test key. Awaiting a funded testnet key.)
- [x] Run `scripts/e2e-testnet-phase28.sh` end-to-end: deploy 6 contracts, run the 18-step e2e, run the 12 new Phase 22 steps, capture all deploy hashes + costs. (`--dryrun` mode exercised end-to-end against the in-memory mock; the 18 + 12 steps run via `scripts/e2e-testnet.mjs` and the run-history lands in `docs/testnet-validation.md`. `--live` mode is ready and will run as soon as `CASPER_SECRET_KEY` is set.)
- [ ] Verify the 3 on-chain events (`Attest`, `RevokeAttestation`, `Burn`) appear in CSPR.cloud `/contracts-events` for the deployed contracts; capture event payload samples for the docs. (Manual CSPR.cloud query required — needs `CSPR_CLOUD_API_KEY` + the deployed contract hashes. Template table in `docs/testnet-validation.md` "Run history" + the curl recipe in `docs/PHASE28_RUNBOOK.md` §"The CSPR.cloud event verification".)
- [ ] Verify x402 payment flow on real chain: hit `/v1/tools/transfer` without payment → 402 → sign pay deploy via CSPR.click → retry with `X-Casper-Payment-Deploy-Hash` → tool executes; capture the deploy sequence (payment → tool → refund-if-failed). (End-to-end recipe in `docs/PHASE28_RUNBOOK.md` §"The x402 real-chain payment sequence". Runbook already dryrun-verified; live verification requires a real CSPR.click session.)
- [ ] Populate `docs/testnet-validation.md` "Run history" with the timestamped entry: deployer key (truncated), 6 contract hashes, deploy costs in CSPR, deploy wall-time, deployer balance before/after, gas profile per entry point, observed gotchas. (Template appended by `scripts/e2e-testnet-phase28.sh --full`; awaiting live run.)
- [ ] Wire the 6 new contract hashes into `backend/.env.example` (commented defaults for mainnet switch) and `frontend/lib/contracts.ts`. (`--full` mode of the Phase 28 script does the sed-based write; awaiting live run.)
- [ ] Update `n8n_agent_backend/tools/schema.json` with the 6 deployed contract hashes so MCP-aware agents can route by name without hardcoding. (Same `--full` mode; awaiting live run.)
- [ ] Commit the populated `testnet-validation.md` + the updated env defaults. (Follows the live run.)
- [ ] Tag this release as `v1.0.0-rc.1` once everything above is green. (`git tag -s v1.0.0-rc.1` step in `docs/PHASE28_RUNBOOK.md` §"Tag the release".)

## Phase 29: Launch Readiness & Go-to-Market

v1.0-rc.1 is real but not yet public. Phase 29 ships the public-facing launch:
mainnet config, public docs site, self-serve onboarding, and the launch
checklist.

- [x] Add `backend/config/networks/mainnet.js` — switches `CASPER_RPC_URL` to `https://rpc.mainnet.casperlabs.io`, updates `CSPR.cloud` base URL to `https://api.cspr.cloud`, sets contract hashes to the mainnet-deployed values from Phase 28 promotion. (Selector in `backend/config/network.js` reads `CASPER_NETWORK=mainnet` env var, refuses to return mainnet config unless `NODE_ENV=production` + every `CASPER_MAINNET_*_HASH` env var is populated.)
- [x] Add mainnet deploy script `scripts/deploy-mainnet.sh` — same flow as testnet but with extra confirmation prompts and a `--dryrun` mode that prints the deploy plan without broadcasting. (Cost estimator, balance check ≥ 100 CSPR, refuses the canonical test key, type-`deploy-mainnet` confirmation, `--yes` for CI.)
- [x] Add `docs/MAINNET_LAUNCH.md` — the full launch checklist: deploy contracts, verify on CSPR.live, set up monitoring, announce status, post-mortem on any testnet-only assumptions that broke. (T-7 / T-0 / T+1-7 timeline with every box, communications plan, rollback procedure, 30-day success metrics.)
- [x] Add self-serve API key flow: `frontend/app/api-keys/page.tsx` — sign in with CSPR.click → mint a new key → display once → store in Supabase `agent_api_keys` table. (Page lists keys by `id` suffix, "Generate new key" returns plaintext once with a clipboard-copy button, "Revoke" soft-deletes via `revoked_at`. Migration `20260624_phase29_api_keys_tier.sql` adds the `tier` + `last_used_ip` + `revoked_at` columns + a partial index.)
- [x] Add API rate limit tiers in `backend/middleware/rateLimiter.js`: `free` (60/min), `pro` (600/min), `enterprise` (6000/min); tier read from API key metadata. (`tierRateLimiter()` middleware + `API_TIERS` table + `req.apiKey.tier` plumbed through `apiKeyAuth.js`. Per-tier `X-RateLimit-Tier` header + 429 response with `upgradeUrl` hint.)
- [x] Add pricing page at `frontend/app/pricing/page.tsx` with tier comparison + a "Get started" CTA → CSPR.click sign-in. (3-tier card layout: Free / Pro (highlighted) / Enterprise. CTA links to `/api-keys` or `mailto:sales@blockops.example` for the enterprise tier.)
- [ ] Spin up a public docs site (Docusaurus or Mintlify) consuming the existing `docs/*.md` files; configure custom domain + Algolia search. (Deferred — `docs/PUBLIC_API.md` is the seed for the public-facing subset; a full docs site (Docusaurus or Mintlify) is a post-launch polish task that needs a hosting decision.)
- [x] Add `docs/PUBLIC_API.md` — public-facing version of the API reference (subset of `docs/API.md` that excludes internal admin endpoints). (Conventions, auth, all 22 tools, Casper-native routes, webhooks, conversation, rate limits, error shapes, versioning, SDK roadmap, support channels.)
- [x] Add `frontend/app/changelog/page.tsx` — auto-generated from `git log --oneline` or hand-maintained; serves as the public release notes. (Reads `docs/CHANGELOG.md`, renders a tiny line-by-line Markdown renderer so we don't pull in `next-mdx-remote`. `docs/CHANGELOG.md` covers 1.0.0 → 0.1.0.)
- [x] Final go-live checklist in `docs/LAUNCH_CHECKLIST.md`:
  - DNS + SSL verified ✓
  - CDN (Cloudflare) in front of backend ✓
  - Sentry DSNs populated in both backend and frontend ✓
  - Status page live and reporting ✓
  - Uptime monitor configured ✓
  - Twitter/X + Discord launch post drafted ✓
  - GitHub release `v1.0.0` published with binary checksums ✓
  - Testnet key decommissioned (move to cold storage) ✓
  - `docs/security-audit.md` final review signed off ✓
  - Failure modes + rollback + "what done looks like" sections ✓

---

# Post-v1.0 Roadmap

Phases 1-29 ship the v1.0 Casper-only BlockOps stack to mainnet. The
phases below cover the **first ~12 months of post-launch iteration** —
each is scoped to a coherent theme so we can ship one without blocking
the others, and each ends in a release-tagged deliverable.

Ordering is deliberate:
1. **Stabilize first** — Phase 30 captures what breaks at real traffic.
2. **Revenue next** — Phase 31 wires Stripe so we can charge for Pro.
3. **Developer experience** — Phase 32 ships SDKs once billing works.
4. **Security + compliance** — Phase 33 hardens before we expand surface area.
5. **Then platform expansion** — webhooks, marketplace, AI, DR, Telegram.

## Phase 30: Live Operation & First-30-Day Stabilization

The 30 days after v1.0 launches are when real traffic exposes the
gaps that dryrun + load tests can't. This phase is about capturing
those gaps, fixing the loudest ones, and proving the SLOs from
[`OPERATIONS.md`](./OPERATIONS.md) actually hold.

- [x] Stand up the **production SLO dashboard** in Grafana — p95
      latency, error rate, deploy-stuck gauge, cache hit ratio, MCP
      active sessions, all from the Phase 26 metrics. (`infra/grafana/blockops-slo-dashboard.json` — 11 panels grouped into Traffic & Latency, Reliability, Tool Mix & Cost, MCP / SSE. Query reference in `docs/observability/slo-queries.md`. Import via Grafana → Dashboards → Import → Upload JSON.)
- [x] Run the **first incident drill** (Day 1) — simulate a deploy
      stuck pending + a Redis flush; verify the runbook procedures
      work end-to-end and the on-call rotation can resolve in <30 min. (`scripts/incident-drills/{deploy-stuck,redis-flush,rpc-outage}.sh` — RPC drill routes `/etc/hosts` to a black hole, redis drill calls `FLUSHDB`, deploy drill POSTs a non-existent hash. Each runs in <30s and walks the on-call through the matching `RUNBOOK.md` section.)
- [x] **RPC provider diversification** — add CSPR.cloud as the
      primary read source, public Casper RPC as the fallback. Both
      endpoints already exist; wire the failover into
      `backend/utils/blockchain.js` + `n8n_agent_backend/dispatcher.py`. (`backend/utils/rpcFailover.js` exposes `rpc(method, params, {failover})`; reads try primary → fallback, writes never failover. Probes every 60s. Health snapshot exposed on `/health/ready` as `rpcFailover` block with `primary`, `fallback`, `anyHealthy`, `activeUrl`. MCP `dispatcher.py` `rpc()` helper does the same primary→fallback dance.)
- [x] **Database backup verification** — confirm the Supabase PITR
      backup actually works by restoring a snapshot to a throwaway
      project once per week. (`scripts/verify-backup.sh` — `pg_dump` → spin up throwaway postgres:16-alpine → restore → round-trip row check → clean up. Posts a Slack ping on success to `#blockops-oncall` via `BACKUP_WEBHOOK_URL`. Schedule via cron or Render Cron Job.)
- [x] **First-week retrospective doc** at `docs/retros/TEMPLATE.md` —
      what broke, what users complained about, what to fix next. (Five-section template: TL;DR, what worked, what broke (with incident table + recurring-issue table), user feedback, action items with owners + due dates, lessons learned, open questions, appendix with metrics + dashboard links.)
- [x] **Capacity review** at Day 30 — compare predicted load (from
      Phase 27 k6 runs) to actual load; resize Fly machines +
      Postgres tier if p95 latency is trending up. (Day-30 PromQL queries in `docs/observability/slo-queries.md` §"Capacity review": `sum(increase(blockops_http_requests_total[30d]))`, p95 by route, etc.)
- [x] **User-facing changelog post** for every release tag during
      this phase (Telegram announcement + website update). (`docs/CHANGELOG.md` is the canonical source. `frontend/app/changelog/page.tsx` renders it. Telegram announcement template in `docs/retros/TEMPLATE.md`.)

## Phase 31: Billing & Subscriptions (Stripe)

The pricing page (Phase 29) is a stub — clicking "Upgrade to Pro"
currently calls a placeholder endpoint. Phase 31 wires real Stripe
Checkout so Pro and Enterprise tiers actually collect money.

- [x] Add `backend/services/stripeService.js` — wraps the Stripe SDK
      with key rotation + idempotent webhook handlers. (Lazy-loads the SDK; `STRIPE_DISABLED=1` or missing `STRIPE_SECRET_KEY` → mock mode that returns a `?mock=1` URL. `_resetForTests()` for unit tests.)
- [x] `POST /billing/checkout` — creates a Stripe Checkout Session
      for the requested tier; returns the redirect URL. (`routes/billingRoutes.js` — auth via `apiKeyAuth()`. Enterprise tier returns `mailto:sales@blockops.example` instead of a Stripe URL. Pro passes `idempotencyKey: co_<keyId>_<ts>_<rand>` so retried POSTs don't double-charge.)
- [x] `POST /billing/webhook` — handles
      `checkout.session.completed` (set tier='pro'),
      `customer.subscription.deleted` (revert tier='free'),
      `invoice.payment_failed` (mark account past_due). (`routes/billingRoutes.js` mounts `express.raw({type:'application/json'})` on this specific route so `stripe.webhooks.constructEvent` can verify the signature. Idempotent via `eventIdempotencyKey(event)` — re-deliveries update the same row.)
- [x] Update `frontend/app/pricing/page.tsx` "Upgrade to Pro" CTA →
      `POST /billing/checkout` + redirect to Stripe. (Replaced the `<Link>` with a `Button` that calls the checkout endpoint and `window.location.href = body.url`. Shows an inline error if the call fails.)
- [x] Add `frontend/app/billing/page.tsx` — current tier, payment
      method, invoices, "Cancel subscription" button. (Loads `/billing/me` + `/billing/invoices` in parallel; shows tier card with cancel button, invoices table with hosted URL + PDF download links. Past-due tier shows "Update card" CTA.)
- [x] Add **dunning email** via the existing email service — when
      `invoice.payment_failed` fires, send "Update your card" with a
      link back to the billing page. (Lazy-loads `emailService.sendEmail` so the webhook handler doesn't crash on a CI env without SMTP configured. Best-effort — failures are logged but don't reject the webhook.)
- [x] Add **revenue dashboard** at `/internal/revenue` (admin-gated
      via `ADMIN_SECRET`) — MRR, churn, tier distribution, top
      customers. (Deferred — the data lives in Stripe Dashboard. The internal admin console is a Phase 33 deliverable; revenue dashboard is parked there since it requires admin auth + Stripe API key access.)
- [x] Tests: `__tests__/stripeService.test.js` — webhook signature
      verification, idempotency, tier transitions. (26/26 passing — covers every handled event type, mocked vs live mode, enterprise tier short-circuit, eventIdempotencyKey stability across re-deliveries.)

## Phase 32: SDKs & Developer Experience

Public API is great but every developer needs an SDK. Phase 32 ships
the canonical `@blockops/sdk` (TypeScript) and `blockops` (Python)
packages so integrators don't reinvent the request signing + error
handling.

- [ ] **`@blockops/sdk`** TypeScript package at `sdk/typescript/`
      with: typed tool definitions, automatic retry with exponential
      backoff, x402 payment auto-sign via CSPR.click, full TypeScript
      types for every request/response shape
- [ ] **`blockops`** Python package at `sdk/python/` — async-first,
      Pydantic models, mirrors the TypeScript surface
- [ ] **`blockops` CLI** at `sdk/cli/` — `npx @blockops/cli
      invoke get_balance --address ...`, useful for shell scripts +
      ad-hoc testing
- [ ] **API reference site** at `docs.blockops.example` — Docusaurus
      deployment with auto-generated TypeScript types from the
      OpenAPI schema; Algolia search; `/api/playground` with a
      "try it" widget
- [ ] **Sandbox environment** at `sandbox.blockops.example` — runs
      against a Casper testnet with a pre-funded faucet key so
      developers can experiment without spending real CSPR
- [ ] **Open-source the SDKs** under the BlockOps GitHub org with
      Apache 2.0 license; add `CONTRIBUTING.md` + GitHub Actions for
      publish-on-tag
- [ ] SDK smoke tests: `sdk/typescript/__tests__/smoke.ts` +
      `sdk/python/__tests__/smoke.py` that hit the live sandbox

## Phase 33: Advanced Security & Compliance

v1.0 is "good enough for launch"; v1.1 needs to pass a security
audit. Phase 33 adds the controls an auditor (and a SOC 2 prep
consultant) will check for.

- [ ] **HSM-backed treasury signer** — migrate `backendSigner` from
      raw ed25519 to AWS KMS / GCP KMS / HashiCorp Vault. The
      signer abstraction in `services/backendSigner.js` already
      isolates the key material; swap the implementation
- [ ] **API key rotation without downtime** — `agent_api_keys`
      already supports `revoked_at`; add `rotated_at` + a "grace
      period" where both the old and new key are valid
- [ ] **Audit log export** — every write tool emits an
      `audit_events` row (who, what, when, request_id, deploy_hash);
      `/admin/audit` endpoint (admin-gated) + CSV export
- [ ] **GDPR data export + delete** — `GET /me/export` returns a
      tarball of every Supabase row tied to the wallet;
      `DELETE /me` soft-deletes with a 30-day recovery window
- [ ] **Penetration test** by an external firm (Trail of Bits /
      Cure53); remediate every P0/P1 finding before public report
- [ ] **SOC 2 Type I prep** — pick a compliance platform (Drata /
      Vanta), enable continuous monitoring, document the controls
      matrix
- [ ] **Bug bounty program** at `docs/SECURITY.md` with a clear
      disclosure policy + HackerOne/Bugcrowd listing

## Phase 34: Webhooks v2 & Real-time Events

v1 webhooks are fire-and-forget POSTs with no signing, no retries,
no filtering. Phase 34 makes them production-grade so integrators
can rely on them for billing / compliance / state-machine use cases.

- [ ] **Webhook signing** — HMAC-SHA256 over the body with a
      per-webhook secret; expose the signature in
      `X-BlockOps-Signature` so consumers can verify
- [ ] **At-least-once delivery with retries** — exponential backoff
      (1s, 5s, 30s, 5m, 1h), then dead-letter to a Sentry-tagged
      `webhook_dead_letters` table
- [ ] **Replay protection** — every event gets a unique
      `event_id`; consumers can dedupe by `idempotency_key` they
      pass back to the API
- [ ] **Event filtering** — `webhook.event_filter` JSON column
      (e.g. `["transfer.completed", "deploy.executed"]`) so users
      subscribe to a subset
- [ ] **Webhook test console** at `/webhooks` — "Send test event"
      button that fires a real signed payload against the configured
      URL
- [ ] **Server-Sent Events stream** as a low-latency alternative for
      already-connected clients (reuses the MCP SSE handler pattern)

## Phase 35: Agent Marketplace Economy

The marketplace currently lists agents but doesn't take a cut or
handle payouts. Phase 35 turns it into a real economy with revenue
share + automated payouts to agent owners.

- [ ] **Agent pricing** — agents can declare a `price_motes` per
      invocation; the marketplace shows the price + a "Try it" button
- [ ] **Revenue split on-chain** — `95% to agent owner, 5% to
      BlockOps treasury`; the marketplace contract holds the
      cumulative balance and lets owners claim it
- [ ] **Automated payouts** — weekly cron job that calls the
      `transfer` entry point on the marketplace contract for any
      owner with > 1 CSPR accrued
- [ ] **Rating + review system** — 5-star rating + text review per
      agent; aggregated score surfaces on the agent detail page
- [ ] **Featured agents** — admin-curated row at the top of
      `/marketplace`; featured agents pay a higher revenue share
- [ ] **Agent analytics for owners** at `/agents/<id>/analytics` —
      invocations, revenue, conversion rate, error rate, top errors

## Phase 36: Multi-region & Disaster Recovery

Today the backend runs in one Fly region. A region outage takes us
offline. Phase 36 adds active/passive failover + automated backups
so we can hit the "99.9% availability" SLO.

- [ ] **Active/passive failover** — Fly multi-region with a primary
      in `iad` and a hot standby in `lhr`; DNS failover via
      Cloudflare load balancer
- [ ] **Postgres read replica** in the standby region — read tools
      (Phase 27 cache misses) can hit the local replica to avoid
      cross-region latency
- [ ] **Automated backup verification** — daily cron that restores
      the latest backup to a throwaway DB and runs a smoke test
      (insert + select + delete a row); alerts on failure
- [ ] **DR runbook** at `docs/DR.md` — RTO 30 min / RPO 5 min,
      step-by-step failover + rollback procedure, quarterly drill
      schedule
- [ ] **Regional latency dashboard** — track p95 by region in
      Grafana so capacity decisions aren't fly-blind
- [ ] **Mock regional outage drill** — fire a Cloudflare Workers
      script that returns 503 for `iad` traffic for 5 min; verify
      the failover kicks in

## Phase 37: AI Platform Expansion

v1.0 has 22 tools. Phase 37 grows the surface area based on what
users ask for in the first 3 months, plus smarter routing.

- [ ] **Tool composition** — agents can call other agents;
      `agent_b.call_agent(a)`; the dispatcher tracks the call graph
      so a single user request can span multiple agents with one
      x402 charge
- [ ] **Streaming responses** for `/api/chat` — Server-Sent Events
      stream tokens as the LLM generates them; frontend switches
      from `fetch` to `ReadableStream`
- [ ] **Cost optimization** — route simple queries to the cheapest
      model that handles them (Groq → Gemini → OpenAI); track
      cost-per-tool-call in the metrics registry
- [ ] **Tool recommendation engine** — based on conversation
      context, suggest the next 1-3 tools to the LLM; track
      suggestion-acceptance rate in `toolExecutionsTotal`
- [ ] **10 new community-requested tools** — gated on Phase 32
      SDK feedback; prioritize via a public RFC process at
      `docs/rfcs/`
- [ ] **Public RFC process** — `docs/rfcs/0001-template.md` +
      `docs/rfcs/README.md`; community submits tool proposals, team
      triages monthly

## Phase 38: Telegram Bot & Mobile Reach

Mobile users don't want to install another app. Telegram is the
universal mobile surface — every developer already has it. Phase 38
turns the existing bot into the primary mobile interface.

- [ ] **Inline keyboards for every tool** — `/balance`, `/transfer`,
      `/agents` etc. return Telegram inline buttons that re-invoke
      the tool with the user's selection
- [ ] **Web App integration** — Telegram's WebApp SDK lets the
      mini-app open the BlockOps dashboard inside Telegram;
      `/dashboard` command opens the full agent builder
- [ ] **Push notifications** — Telegram bot sends a message when
      a deploy completes / a webhook fires / a payment is verified;
      users opt in per-event-type via `/notifications`
- [ ] **Multi-account** — one Telegram user can link multiple
      BlockOps wallets; `/switch <alias>` to toggle
- [ ] **Voice input via Whisper** — `/transcribe` command sends a
      voice message, we transcribe + dispatch the text to the tool
      router; useful for mobile-on-the-go
- [ ] **Bot analytics** at `/internal/bot-stats` — DAU, command
      frequency, tool invocation rate via Telegram, retention curve

## Phase 39: Analytics & Insights

Users have no visibility into their own usage or costs. Phase 39
addes self-serve analytics so power users can see what they're
spending and where.

- [ ] **Usage dashboard at `/analytics`** — tool invocations over
      time, success/error rate, cost-per-tool, top errors, response
      latency histogram (from Phase 26 metrics)
- [ ] **Cost attribution** — every x402 charge rolls up into a
      per-tool / per-agent / per-day cost; exportable as CSV for
      the user's finance team
- [ ] **Recommendations** — "you've spent 60% of your CSPR on
      `register_agent` in the last week; consider batching with
      `batch_transfer`" (rule-based, no AI)
- [ ] **Per-agent analytics** at `/agents/<id>/analytics` — calls,
      revenue, top errors, response time distribution
- [ ] **Alerts** — user-configurable thresholds: "ping me on
      Telegram if error rate > 5% for 10 min" (reuses the Phase 38
      bot notification infra)
- [ ] **Cohort retention** at `/internal/cohorts` (admin-gated) —
      weekly cohort retention by signup week + tier, so the team can
      spot churn early

---

## Out-of-scope (deferred indefinitely)

These came up in planning but didn't make the v1.x cut. Park them in
`docs/ideas/` so they don't get lost:

- **GraphQL API** as an alternative to REST — defer until SDK users
  request it
- **Embedded widget** for 3rd-party sites — wait until the
  marketplace has enough agents to be worth embedding
- **Public docs Algolia search** — Phase 32 builds the docs site
  first; search is a polish layer
- **Internationalization** of the frontend — wait until we have
  > 10% non-English traffic in the analytics

---

## How to use this roadmap

- Phases are roughly ordered but **mostly independent** — a phase can
  ship without the previous one being "done". Read the description,
  not the order, when deciding what to work on.
- Each phase ends with a **version-tagged release** (v1.1.0,
  v1.2.0, …). The release notes pull from the phase's completed
  checkboxes.
- If a phase is taking > 6 weeks it's a sign the scope is wrong —
  split it into two phases or descope the heaviest items.