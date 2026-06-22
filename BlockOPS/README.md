# BlockOPs

### No-Code Platform for Trustworthy Agentic DeFi & RWA on Casper

![Casper Network](https://img.shields.io/badge/Built%20on-Casper%20Network-blue)
![License](https://img.shields.io/badge/License-MIT-green)
![CI](https://img.shields.io/badge/CI-passing-brightgreen)

> **Build. Trust. Deploy. Let Agents Do the Work.**

BlockOPs is a no-code / low-code visual platform that lets developers and
non-technical users build, deploy, and manage trustworthy autonomous AI
agents for DeFi and Real-World Assets (RWA) on the **Casper Network**.

---

## ✨ Features

- **Visual no-code agent builder** (React Flow) with natural-language
  authoring and pre-built templates (Yield Optimizer, RWA Verifier,
  Compliance Guardian, Treasury Executor).
- **22 Casper-native tools**: native CSPR transfers, CEP-18 / CEP-78
  token + NFT operations, agent registry + reputation, escrow,
  compliance, market data.
- **x402 payment protocol** — pay-per-call in CSPR via HTTP 402; the
  client signs a payment deploy via CSPR.click and retries with
  `X-Casper-Payment-Deploy-Hash`.
- **MCP server** (stdio + HTTP/SSE transports) so LangGraph / CrewAI
  agents can use the 22 tools natively.
- **CSPR.click wallet** — no seed phrases, no Lit PKP, no EVM
  leftovers; just sign deploys with the wallet you already have.
- **Odra smart contracts** (4) — AgentFactory, Reputation, Escrow,
  Compliance, plus CEP-18 + CEP-78 sample contracts.

## 🚀 Quick start

```bash
# 1. Clone & install
git clone https://github.com/your-org/BlockOPS.git
cd BlockOPS

# 2. Run the full dev stack (frontend + backend + MCP)
./scripts/dev.sh up
```

`scripts/dev.sh` is the single-command onboarding. It:

- Installs dependencies for `frontend/`, `backend/`, and
  `n8n_agent_backend/`.
- Builds the Odra contracts to WASM (requires Rust nightly + WABT).
- Starts the Next.js frontend on `:3000`, the Express backend on
  `:3000/api`, and the MCP HTTP/SSE transport on `:8080/mcp`.

To stop everything: `./scripts/dev.sh down`.

## 📦 Repo layout

```
.
├── contract/                 Odra smart contracts (Rust → WASM)
│   ├── src/                  AgentFactory / Reputation / Escrow / Compliance / Cep18Token / Cep78Nft
│   ├── scripts/              deploy.js, generate-signer.js, build.sh
│   ├── wasm/                 Build output (6 WASM binaries)
│   └── DEPLOYMENT.md         Casper testnet deploy guide
├── frontend/                 Next.js 15 visual builder + chat
│   ├── app/                  App Router pages (agent chat, marketplace, my-agents, …)
│   ├── components/           React components (workflow-builder, contract-interaction, agent-wallet, …)
│   └── lib/                  Casper wallet (CSPR.click), supabase, x402-client, pricing, errors, sentry
├── backend/                  Express API + tool router (Casper-only)
│   ├── controllers/          11 Casper controllers (agent, agentRegistry, contractChat, conversation, email, nft, price, reminder, token, transfer, webhook)
│   ├── middleware/           x402, x402-verify, requestContext, validate, rateLimiter, apiKeyAuth
│   ├── services/             toolRouter, directToolExecutor, contractDeploymentService, telegramService, …
│   ├── routes/               12 Casper routes (one per controller + healthRoutes)
│   ├── utils/                chains, logger, sentry, agentSchema, helpers
│   └── __tests__/            x402, chains, contractDeploymentService, validate (61 tests)
├── n8n_agent_backend/        MCP server (stdio + HTTP/SSE)
│   ├── mcp_server.py         stdio transport
│   ├── mcp_server_sse.py     FastAPI HTTP/SSE transport
│   ├── dispatcher.py         Unified tool dispatcher (single source of truth)
│   ├── state.py              Redis (1h TTL) + Postgres state layer
│   ├── tools/schema.json     19-tool JSON Schema catalog
│   ├── examples/             LangGraph + CrewAI samples
│   └── __tests__/            stdio + HTTP/SSE smoke (17 tests)
├── scripts/                  Build / test / backfill helpers
│   ├── e2e-testnet.sh        Phase 7/16 lifecycle
│   ├── e2e-testnet.mjs       Casper RPC + CSPR.cloud runner (Phase 7/16 + 22)
│   ├── e2e-testnet-phase22.sh  Phase 22 helper (dryrun + --live modes)
│   └── backfill-csprclick-users.js
├── supabase/migrations/      SQL schema migrations (20260622_casper_schema.sql)
├── docs/                     All human-readable documentation
│   ├── x402.md               x402 payment protocol spec
│   ├── testnet-validation.md Testnet deploy + e2e log
│   ├── security-audit.md     Per-contract security findings
│   ├── ARCHITECTURE.md       System architecture
│   ├── API.md                19 tool endpoints
│   ├── TROUBLESHOOTING.md    Common issues + fixes
│   └── DEV_SETUP.md          Full developer setup
└── .github/workflows/ci.yml  GitHub Actions: contract / backend / frontend / security
```

> **Phase 23**: the backend is **Casper-only**. The 11 EVM-only controllers
> (allowance, batch, bridge, chain, ens, gas, nlExecutor, portfolio,
> schedule, swap, wallet), their routes, and `services/agentCoordinator.js` /
> `services/agentRuntime.js` have been removed. `safeRequire` is gone;
> all routes are eagerly loaded. No `ethers` references remain in
> `backend/services/`, `backend/controllers/`, or `backend/routes/`.

## 🔧 Build the contracts

```bash
cd contract
export RUSTFLAGS="-C link-arg=--unresolved-symbols=import-dynamic"
cargo odra build           # → wasm/AgentFactory.wasm, …, wasm/Cep78Nft.wasm
cargo test                 # 24 unit tests
```

The deploy script signs the WASM with a Casper ed25519 keypair (generated
by `node scripts/generate-signer.js`) and submits it to the testnet.

## 🌐 Deploy to testnet

```bash
# 1. Generate a funded ed25519 signer (testnet faucet first)
cd contract
node scripts/generate-signer.js
# → backend/secrets/testnet-signer.{pem,json} (gitignored)
# → Copy the private key into backend/.env as CASPER_SECRET_KEY

# 2. Deploy all 6 contracts
node scripts/deploy.js

# 3. Wire the contract hashes into backend/.env and frontend/.env.local
#    (see docs/testnet-validation.md for the full deploy log)

# 4. Run the canonical agent lifecycle end-to-end
./scripts/e2e-testnet.sh --skip-deploy
```

## 🧪 Tests

| Suite     | Command                  | What it covers                                |
| --------- | ------------------------ | --------------------------------------------- |
| Contract  | `cd contract && cargo test` | 64 Odra unit tests (v1.0 hardening)     |
| Frontend  | `cd frontend && npm test` | 39 vitest unit tests (wallet, error mapper, x402-client) |
| Backend   | `cd backend && npm run test:unit` | x402 + chains + contractDeploymentService + validate (61 tests) |
| MCP       | `cd n8n_agent_backend && .venv/bin/python -m unittest __tests__.test_smoke` | stdio + HTTP/SSE dispatcher (17 tests) |
| E2E       | `./scripts/e2e-testnet-phase22.sh` | 18-step Phase 22 v1.0 surface (dryrun + --live) |

## 🏗️ Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│  Browser    │ ──► │  Next.js (3000)  │ ──► │  Backend API │
│ (CSPR.click │     │  + React Flow    │     │  Express     │
│  + x402     │     │  + x402-client   │     │  (3000/api)  │
│  + Casper   │     │                  │     │  + x402      │
│  wallet)    │     │                  │     │  middleware  │
└─────────────┘     └──────────────────┘     └──────┬───────┘
                                                    │
                                          ┌─────────▼──────────┐
                                          │  Casper Testnet    │
                                          │  + CSPR.cloud      │
                                          │  + Odra contracts  │
                                          └─────────▲──────────┘
                                                    │
                              ┌─────────────────────┴────────┐
                              │                              │
                       ┌──────▼──────┐               ┌──────▼──────┐
                       │  MCP Server │               │  LangGraph  │
                       │  (8080)     │ ◄─────────── │  / CrewAI   │
                       │  HTTP+SSE   │               │  agents     │
                       └─────────────┘               └─────────────┘
```

See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the full
end-to-end flow.

## 📚 Documentation

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — system architecture
- [`docs/API.md`](./docs/API.md) — 22 tool endpoints (params + responses + x402 pricing)
- [`docs/x402.md`](./docs/x402.md) — x402 payment protocol spec
- [`docs/testnet-validation.md`](./docs/testnet-validation.md) — testnet deploy log
- [`docs/security-audit.md`](./docs/security-audit.md) — per-contract security findings
- [`docs/TROUBLESHOOTING.md`](./docs/TROUBLESHOOTING.md) — common issues + fixes
- [`docs/DEV_SETUP.md`](./docs/DEV_SETUP.md) — full developer setup
- [`n8n_agent_backend/README.md`](./n8n_agent_backend/README.md) — MCP server guide

## 🛠️ Stack

- **Frontend**: Next.js 15, React 18, React Flow 11, Tailwind 4, Vitest
- **Backend**: Node 20, Express 4, casper-js-sdk 2, Supabase, Groq, OpenAI, zod
- **MCP**: Python 3.11, FastAPI, MCP, asyncpg, redis-py
- **Contracts**: Rust nightly, Odra 2.8.1
- **CI**: GitHub Actions (cargo test + odra build + clippy, npm test, next build, npm audit)

## 🤝 Contributing

1. Fork → branch → make your change.
2. Add tests (`cargo test` for contracts, `vitest` for frontend,
   `node --test` for backend).
3. Run `./scripts/dev.sh up` and confirm the e2e flow still works.
4. Open a PR with a clear description of the change.

## 📄 License

MIT — see [`LICENSE`](./LICENSE).
