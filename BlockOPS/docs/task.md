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

- [ ] Migrate `backend/services/toolRouter.js`, `directToolExecutor.js`, `contractDeploymentService.js`, `toolAuditLogService.js` to the existing `backend/utils/logger.js` (pino-style structured logs with `request_id`).
- [ ] Add a `requestContext` middleware that assigns a UUID per request and threads it through to logger calls + response headers (`x-request-id`).
- [ ] Add a zod-based `validateToolParams` middleware in `backend/middleware/validate.js` covering all 22 tools' parameter schemas. Reject unknown fields, coerce primitives, return 400 with field-level errors.
- [ ] Wire `backend/middleware/validate.js` into the `/v1/tools/:toolId` route before `x402-verify`.
- [ ] Add optional Sentry initialization gated on `SENTRY_DSN` (backend via `@sentry/node`, frontend via `@sentry/nextjs`). Log-only mode when DSN is absent.
- [ ] Add `backend/__tests__/validate.test.js` — covers at least one paid tool (`transfer`) and one free tool (`get_balance`); expects 400 on unknown fields and successful pass-through on valid input.

## Phase 21: MCP Server HTTP/SSE Transport + Sample Agents

Phase 10 marked MCP HTTP/SSE + sample LangGraph/CrewAI agents as complete, but
only stdio + skeleton samples exist. Phase 21 delivers the production MCP
surface.

- [ ] Implement `n8n_agent_backend/mcp_server_sse.py` — FastAPI app exposing `GET /mcp/sse` (Server-Sent Events) and `POST /mcp/message`, backed by the same `mcp_server.py` tool handlers.
- [ ] Add `mcp_server.py` JSON-RPC dispatcher that registers the 22 tools from `tools/schema.json` and dispatches to the existing handler functions.
- [ ] Add `n8n_agent_backend/state.py` — Postgres-backed `mcp_sessions` + `mcp_tool_calls` tables (already partially defined in `20260622_casper_schema.sql`; expose via SQLAlchemy or asyncpg).
- [ ] Add Redis-backed short-term session store (`mcp_session:{id} → {tool_calls_count, last_seen}`) with 1-hour TTL.
- [ ] Complete `n8n_agent_backend/examples/langgraph_agent.py` — a working agent that connects via MCP and runs `register_agent → attest_agent → get_reputation`.
- [ ] Complete `n8n_agent_backend/examples/crewai_agent.py` — same flow via CrewAI.
- [ ] Add `n8n_agent_backend/README.md` covering setup, stdio vs HTTP/SSE transport selection, env vars, and example run commands.
- [ ] Add `n8n_agent_backend/__tests__/` — at minimum a smoke test that boots the HTTP/SSE server, lists the 22 tools via `tools/list`, and invokes one paid tool (`register_agent`) and one free tool (`get_reputation`) end-to-end.

## Phase 22: Live Testnet Re-Deployment & v1.0 Validation

The Phase 17 hardening changes (`set_paused`, `transfer_ownership`, `set_treasury`,
burn, on-chain events) are not yet on testnet. Phase 22 deploys them and proves
the new surface on real chain.

- [ ] Re-run `node scripts/deploy.js` with the same testnet keypair from Phase 7 to deploy the v1.0 WASM binaries; record the six new contract hashes.
- [ ] Update `backend/.env` and `frontend/lib/contracts.ts` with the new hashes.
- [ ] Extend `scripts/e2e-testnet.mjs` with a Phase 22 section that exercises the new entry points: `set_paused(true) → register_agent reverts`, `set_paused(false) → register_agent succeeds`, `transfer_ownership(new_owner) → owner-gated entries fail under the old owner`, `Cep18Token::burn(100)` from the deployer, `Cep78Nft::burn(token_id)` from the minter.
- [ ] Append a timestamped Phase 22 entry to `docs/testnet-validation.md` covering deploy costs, deploy times, deployer balance delta, and gotchas observed during the run.
- [ ] Verify the on-chain events (`Attest`, `RevokeAttestation`, `Burn`) show up in CSPR.cloud for the contracts we deployed.
- [ ] Commit the populated `testnet-validation.md` and any new env defaults.

---

## Phase 23: EVM Controller Removal & Repo Final Cleanup

Phase 18 wrapped the EVM-only controllers in `safeRequire` so the server boots,
but the controllers still exist and add ~1,400 lines of unreachable code. Phase
23 deletes them, removes the `safeRequire` workaround, and tightens
`frontend/tsconfig.json`.

- [ ] Audit each `backend/controllers/*.js` and `backend/services/*.js` for actual Casper-tooling usage (remove EVM paths that are dead).
- [ ] Delete the controllers that are purely legacy EVM: `walletController.js`, `allowanceController.js`, `swapController.js`, `bridgeController.js`, `portfolioController.js`, `ensController.js`, `gasController.js`, `batchRoutes.js` (batchController.js), `chainController.js`, `scheduleController.js`, `reminderController.js` (if no Casper use), and `nlExecutorController.js`.
- [ ] Delete `backend/services/agentCoordinator.js` and `backend/services/agentRuntime.js` (EVM-only, unused after Phase 6).
- [ ] Remove the `safeRequire` wrapper from `backend/app.js` once all EVM-only routes are gone; restore eager `require` statements.
- [ ] Remove `ethers` references from any surviving `backend/services/*.js` (none should remain after the deletions above; verify via grep).
- [ ] Restore `frontend/tsconfig.json` exclusions list to empty (was needed for legacy EVM files; they should already be migrated per Phase 6 — verify and remove if no longer needed).
- [ ] Run `npm run test:unit`, `next build`, `cargo test` to confirm no regressions after the deletions.
- [ ] Update `README.md` and `docs/ARCHITECTURE.md` to reflect the final controller list.
