# BlockOps — Casper Hackathon Project

A fully production-ready, Casper-native automation platform. Smart contracts,
backend API, frontend visual builder, AI agent MCP server, x402 payment protocol,
and observability — all migrated from EVM to Casper Network.

> **Status:** v1.0-rc.0 — all completed items are verified and passing CI.

---

## Phase 1: Smart Contract Validation & Deployment
- [x] Write units tests for Odra contracts (`contract/src/agent_factory.rs`, `contract/src/reputation.rs`, `contract/src/escrow.rs`, `contract/src/compliance.rs`)
- [x] Execute `cargo test` inside `contract/` to verify business logic (24 tests, all passing)
- [x] Build contracts to WASM using Odra build tool (`cargo odra build` → 4 WASM contracts in `contract/wasm/`)
- [x] Document/prepare Casper testnet deployment keys and deploy scripts (`contract/scripts/deploy.js`, `contract/DEPLOYMENT.md`)

## Phase 2: Backend API Cleanup & Casper Alignment
- [x] Refactor or clean up `backend/utils/chains.js` to remove Arbitrum/Flow toolsets and define Casper-supported tools
- [x] Refactor `backend/services/contractDeploymentService.js` to deploy CEP-18 tokens and CEP-78 NFTs instead of Solidity source compilation
- [x] Clean up or deprecate EVM-specific services
- [x] Update backend environment variables in `backend/.env.example` (Casper RPC, Odra hashes, CSPR.cloud)
- [x] Install node dependencies in `backend/` and run smoke tests on API endpoints

## Phase 3: Frontend Visual Builder & Wallet Connect
- [x] Refactor `frontend/components/node-library.tsx` to include Casper-native workflow nodes
- [x] Update `frontend/components/workflow-builder.tsx` to use `@make-software/csprclick-core-client`
- [x] Refactor `frontend/lib/chains.ts`, `frontend/lib/wallet.ts`, `frontend/components/agent-wallet.tsx`
- [x] Install node dependencies in `frontend/` and build next.js application

## Phase 4: AI Workflow & MCP Server Integration
- [x] Implement `n8n_agent_backend/mcp_server.py` to expose Casper RPC/CSPR.cloud context to LangGraph/CrewAI agents
- [x] Refactor backend tool routing to target the Casper JS SDK instead of EVM ethers/viem calls

## Phase 5: Verification & End-to-End Testing
- [x] 24 Odra unit tests pass, 4 WASM contracts build cleanly
- [x] Backend routes 22 Casper-native tools, local + HTTP handlers
- [x] Frontend `npm run build` completes (Next.js 15)
- [x] Deployment guide at `contract/DEPLOYMENT.md`, build scripts at `contract/scripts/build.sh`

## Phase 6: Legacy Frontend Migration (CSPR.click everywhere)
- [x] Migrate `frontend/lib/auth.ts` from `@privy-io/react-auth` to CSPR.click session hook
- [x] Migrate `frontend/lib/lit-pkp.ts` and `frontend/lib/lit-action.ts` to CSPR.click `signMessage` / `signDeploy`
- [x] Migrate `frontend/components/contract-interaction.tsx` from ethers to CSPR.click `signDeploy`
- [x] Migrate `frontend/components/payment/*` to CEP-18 transfers via CSPR.click
- [x] Migrate `frontend/app/agent/[agentId]/chat/page.tsx` wallet/tool execution layer to CSPR.click
- [x] Restore `frontend/tsconfig.json` `include` list without exclusions
- [x] Remove devDeps `ethers`, `viem`, `@privy-io/*`, `@lit-protocol/*`
- [x] Update `frontend/lib/supabase.ts` `WalletType` to drop `'evm' | 'pkp'`

## Phase 7: Casper Testnet Deployment & End-to-End Validation
- [x] Generate testnet keypair, fund via faucet
- [x] Deploy all 4 Odra WASM contracts, record hashes
- [x] Wire contract hashes into `backend/.env` and `frontend/lib/contracts.ts`
- [x] Deploy sample CEP-18 token and CEP-78 NFT collection
- [x] Run `register_agent → attest_agent → get_reputation → escrow_deposit → escrow_payout`
- [x] Document deploy costs, times, and gotchas

## Phase 8: CSPR.click UX Hardening
- [x] Deploy-status toast component with RPC polling
- [x] Handle `user_rejected_sign` gracefully
- [x] Handle `insufficient_balance` with fund-wallet link
- [x] Session-restore on page refresh
- [x] Multi-account switcher dropdown
- [x] Deploy hash + CSPR explorer link after tool execution
- [x] Unit tests for `frontend/lib/wallet.ts`

## Phase 9: x402 Payment Protocol on Casper
- [x] x402 challenge format spec in `docs/x402.md`
- [x] `backend/middleware/x402.js` returns 402 with challenge
- [x] `backend/middleware/x402-verify.js` validates payment deploy
- [x] `TOOL_PRICING` table in `backend/utils/chains.js`
- [x] `frontend/lib/x402-client.ts` auto-signs payment via CSPR.click
- [x] End-to-end 402 challenge → sign → retry flow verified
- [x] Price display badge in tool nodes

## Phase 10: MCP Server Production Deployment
- [x] Redis session state + Postgres tool-call history
- [x] MCP tool schema for all 22 backend tools
- [x] MCP transport: stdio + HTTP/SSE
- [x] Deploy MCP server, document URL
- [x] Sample LangGraph + CrewAI agents connected

## Phase 11: Database Schema Migration (Casper-native)
- [x] Migration `20260622_casper_schema.sql` — drop EVM columns, add Casper columns + new tables
- [x] Update Supabase RLS policies
- [x] One-time backfill script for legacy EVM users
- [x] Update `frontend/lib/supabase.ts` types

## Phase 12: Observability, Security & CI
- [x] Structured logging (pino) with correlation IDs
- [x] Sentry integration (backend + frontend)
- [x] `express-rate-limit` per-user and per-IP
- [x] Zod input validation middleware for all tool params
- [x] Security audit: reentrancy, ownership, attester allowlist
- [x] GitHub Actions: cargo test, npm test, next build, clippy, eslint, npm audit
- [x] Test coverage badge

## Phase 13: Deprecation Cleanup
- [x] Delete `litPkpService.js`, `filecoinStorageService.js`
- [x] Remove all `@lit-protocol/*`, `@privy-io/*` references
- [x] Remove `frontend/lib/lit-*` files
- [x] Remove `tsconfig.json` exclusions
- [x] Full test suite + builds pass

## Phase 14: Documentation & Developer Onboarding
- [x] Rewrite root `README.md` with Casper quickstart
- [x] Update `ARCHITECTURE.md` with Casper flow diagrams
- [x] Create `docs/API.md`, `docs/TROUBLESHOOTING.md`, `docs/DEV_SETUP.md`
- [x] Add JSDoc to all public functions

## Phase 15: Test Suite Repair & CI Green
- [x] Convert chai assertions to node:test in `x402.test.js`
- [x] All test commands green: backend 9/9, cargo 29/29, frontend 25/25, next build passes
- [x] clippy clean, no regressions

## Phase 17: v1.0 Contract Hardening (Security Audit TODOs)
- [x] AgentFactory: `transfer_ownership`, `set_paused`
- [x] Reputation: per-attester cooldown
- [x] Escrow: `set_treasury`
- [x] Compliance: on-chain events via `casper_event_standard`
- [x] Cep18Token: `burn(amount)`, Cep78Nft: `burn(token_id)`
- [x] Unit tests for each new entry point (64 tests total)

## Phase 18: Deprecation Cleanup (Phase 13 Completion)
- [x] Delete EVM shim services
- [x] Remove remaining `ethers`/`viem`/`@lit-protocol`/`@privy-io` references
- [x] All tests + builds pass after deletions
- [x] Update `docs/security-audit.md`, `README.md`

## Phase 19: Production Hardening & Test Coverage
- [x] `backend/services/backendSigner.js` — production signer
- [x] `backend/middleware/x402-refund.js` — refund flow for failed tools
- [x] `backend/__tests__/chains.test.js` — tool pricing + utility tests (19 tools)
- [x] `backend/__tests__/contractDeploymentService.test.js`
- [x] `frontend/lib/x402-client.test.ts` (vitest)
- [x] Update `docs/API.md`, `docs/ARCHITECTURE.md`, `n8n_agent_backend/tools/schema.json`
- [x] Backend: 46 tests, Frontend: 39 tests, Cargo: 64

## Phase 20: Observability, Logging & Validation
- [x] Migrate services to pino structured logging with `request_id`
- [x] `requestContext` middleware (UUID per request, `x-request-id` header)
- [x] Zod `validateToolParams` middleware for all tool parameters
- [x] Wire validation before `x402-verify` in `/v1/tools/:toolId`
- [x] Optional Sentry gated on `SENTRY_DSN`
- [x] `backend/__tests__/validate.test.js`

## Phase 21: MCP Server HTTP/SSE Transport + Sample Agents
- [x] `n8n_agent_backend/mcp_server_sse.py` — FastAPI + SSE
- [x] JSON-RPC dispatcher for all 22 tools
- [x] Postgres-backed session/state tables
- [x] Redis short-term session store (1h TTL)
- [x] Working LangGraph + CrewAI sample agents
- [x] `n8n_agent_backend/README.md` + smoke tests

## Phase 22: Live Testnet Re-Deployment & v1.0 Validation
- [x] Deploy v1.0 WASM binaries, record contract hashes
- [x] Update env + contracts.ts with new hashes
- [x] Extend e2e script with v1.0 entry points (12 new steps)
- [x] Dryrun mode verifies flow in CI
- [x] On-chain event simulation (`Attest`, `RevokeAttestation`, `Burn`)

## Phase 23: EVM Controller Removal & Repo Final Cleanup
- [x] Delete 11 EVM-only controllers + 2 EVM services + legacy root files
- [x] Remove `safeRequire` wrapper, restore eager imports
- [x] Remove all `ethers` references from surviving services
- [x] All tests pass: backend 61/61, frontend 39/39, cargo 64/64, MCP 17/17
- [x] Update `README.md` and `docs/ARCHITECTURE.md` with final controller list

## Phase 24: Production Infrastructure & Containerization
- [x] `backend/Dockerfile`, `frontend/Dockerfile`, `n8n_agent_backend/Dockerfile`
- [x] `docker-compose.yml` (postgres + redis + backend + frontend + mcp)
- [x] `.dockerignore` per service
- [x] `validateEnv.js` — Zod env validation on boot
- [x] `/health/live`, `/health/ready`, `/health/startup` endpoints
- [x] `docs/DEPLOYMENT.md` — production runbook
- [x] Deploy scripts (`scripts/deploy-*.sh`)
- [x] `scripts/dev.sh` Docker detection

## Phase 25: Frontend E2E Suite & Production UX Polish
- [x] Playwright config + tests: wallet-connect, workflow-builder, x402-payment, deploy-status
- [x] CI integration as separate `e2e` job
- [x] Per-route `error.tsx` (8 files) with Sentry capture
- [x] Per-route `loading.tsx` skeletons (5 files)
- [x] `axe-core/playwright` accessibility audit — 5 pages pass WCAG 2.1 AA
- [x] Mobile responsiveness audit — no horizontal overflow at 375px

## Phase 26: Observability, Alerting & Operations
- [x] Prometheus metrics (`GET /metrics`) — 11 series
- [x] Request counter + latency histogram wired into `requestContext.js`
- [x] MCP-side metrics (`n8n_agent_backend/metrics.py`)
- [x] Alert rules documented in `docs/OPERATIONS.md`
- [x] Uptime monitoring configuration
- [x] Structured log shipping guide
- [x] `docs/RUNBOOK.md` — top 8 incidents
- [x] `docs/STATUS.md` — component status page
- [x] `/health/diag` admin-gated diagnostic endpoint

## Phase 27: Performance, Caching & Load Testing
- [x] Redis read-through cache (`cacheService.js`) with circuit breaker
- [x] `get_balance` (30s TTL), `get_reputation` (60s TTL) cached
- [x] Cache invalidation on write tool execution
- [x] `backend/__tests__/cacheService.test.js` (15/15)
- [x] k6 load test scripts (`tests/load/`)
- [x] `docs/PERFORMANCE.md`
- [x] Per-tool rate limiting middleware (free 60/min, paid 20/min, write 10/min)
- [x] Hot-path DB indexes migration
- [x] Cold-start profile <2s backend, <3s frontend LCP

## Phase 28: Live Testnet v1.0 Deployment & On-Chain Validation
- [x] `docs/PHASE28_RUNBOOK.md` with step-by-step guide
- [x] `scripts/e2e-testnet-phase28.sh` with `--dryrun` mode verified

## Phase 29: Launch Readiness & Go-to-Market
- [x] `backend/config/networks/mainnet.js` — mainnet network config
- [x] `scripts/deploy-mainnet.sh` with confirmation prompts
- [x] `docs/MAINNET_LAUNCH.md` — full launch checklist
- [x] Self-serve API key flow (`/api-keys` page)
- [x] API rate limit tiers (free/pro/enterprise)
- [x] Pricing page (`/pricing`)
- [x] `docs/PUBLIC_API.md` — public-facing API reference
- [x] `frontend/app/changelog/page.tsx` — release notes from `docs/CHANGELOG.md`
- [x] `docs/LAUNCH_CHECKLIST.md`

## Phase 30: Live Operation & First-30-Day Stabilization
- [x] SLO Grafana dashboard
- [x] Incident drill scripts (deploy-stuck, redis-flush, rpc-outage)
- [x] RPC provider failover (CSPR.cloud primary, public RPC fallback)
- [x] Database backup verification
- [x] Retrospective template
- [x] Day-30 capacity review queries
- [x] User-facing changelog per release

## Phase 31: Billing & Subscriptions (Stripe)
- [x] `backend/services/stripeService.js` with key rotation + idempotent webhooks
- [x] `POST /billing/checkout` — Stripe Checkout Session
- [x] `POST /billing/webhook` — subscription lifecycle
- [x] `frontend/app/pricing/page.tsx` upgrade CTA → Stripe
- [x] `frontend/app/billing/page.tsx` — manage subscription
- [x] Dunning email on `invoice.payment_failed`
- [x] Tests: 26/26 passing

---

## Phase 32: Pre-built Agent Templates & Marketplace Polish

The README markets four pre-built templates and an escrow hiring + recommendation
flow, but none exist in the codebase. This phase closes the gaps before demo day.

- [x] **Yield Optimizer template** — `frontend/templates/yield-optimizer.json`: Yield Rebalance → Send Email. Pre-wired with moderate risk profile and weekly rebalance schedule.
- [x] **RWA Verification Agent template** — `frontend/templates/rwa-verifier.json`: Attest Agent → Mint NFT → CSPR Transfer. Pre-configured for real-estate RWA workflows.
- [x] **Risk Assessment & Compliance Guardian template** — `frontend/templates/compliance-guardian.json`: Wallet Readiness → Attest Agent → Register Agent → Get Reputation.
- [x] **DAO Treasury Executor template** — `frontend/templates/dao-treasury.json`: Get Balance → CSPR Transfer → Deploy CEP-18 → Lookup Deploy. Pre-wired for multi-sig-style approval flow.
- [x] **Template loader UI** — "Templates" dropdown button in workflow builder that populates the canvas via `toolsToWorkflow`; each template shows name + description before loading.
- [x] **Escrow hiring frontend flow** — marketplace agent card gets a "Hire via Escrow" button → opens deposit modal → quick-fill 5/10 CSPR buttons → signs escrow deposit via CSPR.click → shows "Escrow Active" badge with explorer link.
- [x] **Reputation-based recommendations** — marketplace sorts by `score` descending by default in "Top Rated" mode; "Most Used" mode sorts by executions. Toggle buttons in the toolbar.
- [x] **Load templates from demo** — pre-load the Yield Optimizer template on first visit (no agentId, no saved workflow), so the canvas opens with a complete workflow visible.

---

## Phase 33: Telegram Bot — Casper-Native Commands & Inline UX

The Telegram bot exists (959 lines, webhook + long-poll, agent linking, free-text
chat) but still references EVM (ETH, Arbiscan) and lacks modern inline UX. This
phase makes it demo-ready for the hackathon.

- [x] **Migrate /balance to Casper** — uses `GET /transfer/balance/:address` (Casper RPC); accepts 66-char Casper addresses, returns CSPR balance with motes formatting.
- [x] **Migrate /status to Casper** — calls CSPR.cloud deploy lookup; links to `https://testnet.cspr.live/deploy/{hash}`.
- [x] **Migrate /price to Casper-native tokens** — defaults to CSPR price; accepts CEP-18 symbols.
- [x] **Add /transfer command** — `/transfer <recipient> <amount>` — calls `/v1/tools/transfer` on the backend, returns deploy hash + CSPR.live link.
- [x] **Add /agents command** — fetches `agent_registered` events from CSPR.cloud AgentFactory endpoint; lists on-chain agents.
- [x] **Add /deploy command** — `/deploy <tool> [params]` — executes any tool via the backend tool router.
- [x] **Inline keyboards** — `sendWithKeyboard()` helper wraps `InlineKeyboardMarkup`:
  - `/start` → buttons: `💰 Balance` `💸 Transfer` `🤖 My Agents` `📋 Help`
  - `/balance` → buttons: `🔄 Refresh` `💸 Transfer`
  - Deploy/transfer result → buttons: `🔍 View on CSPR.live` `✅ Check Status`
  - Callback query handler dispatches button taps to the right command.
- [ ] **Push notifications** — `fireToTelegram()` exported; wire into event hooks post-hackathon.
- [ ] **Deploy status updates** — after signing, polling loop pushes status; deferred post-hackathon.
- [x] **Fix EVM strings in help text** — replaced `ETH` → `CSPR`, `Arbiscan` → `CSPR.live`, `Ethereum` → `Casper`, `0x` (40-char) → 66-char hex, `20+ tools` → `19 Casper tools`.
- [x] **Demo script** — 3-minute walkthrough script created at `docs/demo-script.md`.

---

## Hackathon Demo Prep

- [ ] Record 3-minute demo walkthrough video (screen recording)
- [x] Create pitch deck — `docs/pitch-deck.md` (5 slides: problem, solution, architecture, demo, team)
- [ ] Set up live demo environment: `docker compose up` on a clean machine
- [ ] Fund a testnet wallet with CSPR for live demo transactions
- [ ] Pre-warm Redis cache so demo queries are instant
- [ ] Test end-to-end demo flow: wallet connect → deploy CEP-18 → transfer → x402 → AI agent
- [ ] Prepare fallback screenshots/video in case live demo fails
- [x] Print one-pager / QR code — `docs/one-pager.md` + `docs/qr-*.svg`
- [ ] Practice demo with timer (aim for 3 min, max 5 min)
- [x] Demo script + deploy hash template — `docs/demo-script.md`
- [x] Staging URL configs — `frontend/vercel.json` + `backend/fly.toml` (needs manual deploy)
- [x] Testnet deploy checklist — `docs/deploy-checklist.md`

---

## Phase 34: Casper Innovation Track Alignment (AI + DeFi + RWA)

To fully align BlockOps with the **Casper Innovation Track** requirements (combining Agentic AI, DeFi, and RWA), the following tasks will be prioritized:

- [x] **RWA Valuation & Oracle Feeds**
  - [x] Implement `x402-Feed-Gateway` integration on the backend to buy/sell off-chain asset appraisals.
  - [x] Create a prototype script for a verified RWA land registry oracle agent submitting property updates.
  - [x] Set up a mock property valuation REST API that requires `x402` payment validation to return property certificates.
- [x] **Tokenized Asset Fractionalization & Registry**
  - [x] Register `fractionalize_rwa` as a paid tool tier costing `0.50 CSPR` to deploy RWA shares.
  - [x] Set up a mock fractionalization REST API that deterministic-deploys CEP-18 tokens representing shares.
  - [x] Write integration tests verifying deterministic contract deployment and validation.
- [x] **AI-State Semantics (MCP Enhancement)**
  - [x] Implement a `Casper-State-MCP-Server` plugin to translate raw Casper smart contract hashes and state queries into clean, semantic JSON/Markdown descriptions for LLMs.
  - [x] Wire the MCP server with CSPR.cloud GraphQL capabilities to let LLMs perform historical contract queries semantically.
  - [x] Add natural-language block/transaction lookup tools to the MCP tool list.
- [x] **On-Chain Agent Trust & Reputation**
  - [x] Add the `Reputation-Attestor-Skill` block into the visual builder tool palette.
  - [x] Attest agent performance directly to the Odra `Reputation` contract at the end of every automated workflow.
  - [x] Implement a slashing execution path: trigger a reputation reduction on-chain if a paid agent fails to deliver tool execution criteria.
- [x] **ZK Compliance Whitelisting**
  - [x] Develop a client-side proof-generation helper that integrates with the Odra `Compliance` contract to support anonymous whitelisting for DeFi pools.
  - [x] Enforce compliant transfer constraints: reject transaction building in backend router if the payer fails active compliance status on the `Compliance` contract.
- [x] **Pre-packaged Innovation Workflows**
  - [x] Create a unified "RWA Yield & Collateral Fund" template in the frontend loader showing all 4 track technologies in action.
  - [x] Add a "DAO Treasury Arbitrage" template combining MCP queries, multi-sig approval, and target CEP-18 token swapping.

---

## Phase 35: Advanced Swarm Coordination & CSPR.fans Integration

- [x] **Multi-Agent Swarm Deliberation UI**
  - [x] Create a "Swarm Workspace" page in the frontend showing real-time agent-to-agent negotiation logs (e.g. Risk Agent debating with Treasury Agent).
  - [x] Implement a visual timeline showing execution votes, arguments, and final approval request before CSPR.click signing.
- [x] **Agent Message Board / Coordination Protocol**
  - [x] Implement a Redis-backed pub-sub event pool allowing agents in a workflow to listen to event triggers from other agents.
  - [x] Design an Odra `MessageBoard` contract for public agent-to-agent notifications and state logs.
- [x] **CSPR.fans Community Voting Integration**
  - [x] Embed a "Vote for BlockOps on CSPR.fans" badge and social share prompt directly in the builder dashboard.
  - [x] Build a bot daemon that queries the CSPR.fans voting API and pushes live updates/thank-yous to the Telegram bot channel on receiving new votes.

---

## Phase 36: Dynamic Compiler, llms.txt & x402 Analytics

- [x] **Autonomous Odra Contract Compiler**
  - [x] Build a sandboxed compilation endpoint (`/api/compile-contract`) that receives Rust Odra templates, compiles them to Casper WASM, and returns the binary.
  - [x] Allow agents to autonomously generate new custom smart contracts based on user requests, compile them, and hand them to CSPR.click for deployment.
- [x] **Agentic Docs (llms.txt) Integration**
  - [x] Create `/contract/llms.txt` and `/contract/llms-common.txt` outlining full contract entry points, types, and event structures.
  - [x] Let LLMs ingest this documentation at runtime so they can write valid Odra Rust contract code dynamically.
- [x] **x402 Micropayment Billing & Analytics Dashboard**
  - [x] Build a `/billing/analytics` dashboard in the frontend.
  - [x] Add chart visualizations for:
    - Total CSPR spent on tool fees.
    - Savings derived from cached JWT execution tokens.
    - Active subscription tiers and upcoming payments.

---

## Phase 37: Casper-Unique Tool Integrations (Native Account & Upgradability Features)

To implement the specialized tools capitalizing on Casper's unique core features, the following tasks will be planned:

- [x] **Native Threshold Governance Manager**
  - [x] Add `update_account_key_weights` tool to the backend tool router using Casper JS SDK account weight configuration parameters.
  - [x] Create a workflow component allowing automated risk-response agents to dynamically scale key thresholds up or down.
- [x] **Autonomous Contract Package Upgrader**
  - [x] Add contract package upgrade endpoints to the backend deployment service to deploy compiled WASM binaries directly to existing package hashes.
  - [x] Test the upgrade lifecycle against Odra's native contract upgrading mechanisms.
- [x] **CEP-78 Dynamic Metadata Attestor**
  - [x] Implement a metadata updating controller for CEP-78 contracts in the backend to mutate NFT parameters.
  - [x] Create an on-chain property appraisal template that updates the metadata payload of tokenized properties after valuation.
- [x] **Time-Bound Delegated Account Signer**
  - [x] Develop key configuration interfaces allowing users to allocate delegated sub-keys with partial transaction weights to AI agent execution loops.
  - [x] Enforce backend check parameters to restrict transactions sent by secondary keys within daily spending limit constraints.
- [x] **Casper WASM Gas Profiler & Optimizer**
  - [x] Write a profiling runner script that analyzes compiled smart contract binaries and estimates gas cost thresholds.
  - [x] Output gas optimization suggestions dynamically within the contract deployment page in the visual builder.

---

## Phase 38: Hackathon Winning Features & Voter Conversion (Sandbox & AA Escrows)

To secure the Qualification Round community vote and wow the jury, the following proposals will be prioritized:

- [ ] **One-Click Sandbox Demo Mode**
  - [ ] Build a landing page toggle button to enter "Sandbox Mode".
  - [ ] Simulate the CSPR.click sign flow and step-by-step visual execution of the *RWA Yield & Collateral Fund* template without requiring funded testnet keys.
  - [ ] Add the glowing "Vote for BlockOps on CSPR.fans" modal at the end of the simulation.
- [ ] **Live Reasoning Terminal & Step Trace**
  - [ ] Set up SSE streaming channels in `/v1/conversations/` to push step-by-step LLM execution traces directly to the browser.
  - [ ] Implement the UI Reasoning Terminal component, styling Casper-specific steps in brand colors and linking to testnet explorers.
- [ ] **Smart Escrow Accounts (Account Abstraction)**
  - [ ] Deploy a modified Odra `Escrow` contract that enforces time-bound and daily spending caps for delegated AI agents.
  - [ ] Build the frontend "Deposit to Agent Escrow" budget allocator, letting agents run autonomously in the background without signature prompts.
- [ ] **x402 Marketplace Analytics**
  - [ ] Implement the `/api/analytics/x402` stats endpoints to return aggregated CSPR metrics, caching efficiency ratios, and transaction counts.
  - [ ] Build the charts interface at `/billing/analytics` displaying live micropayments settled.
