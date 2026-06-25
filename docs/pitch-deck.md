# CasperOPs — Trustworthy Agentic DeFi & RWA on Casper

> Casper Agentic Buildathon 2026 Submission

---

## Slide 1: The Problem

| | |
|---|---|
| **Issue** | AI agents can't be trusted with real money |
| **Why?** | Current agents run off-chain with no on-chain accountability. No audit trail, no escrow, no slashing. Users have no recourse when an agent makes a bad trade or disappears with funds. |
| **Scale** | $100B+ in agent-managed assets expected by 2028 — but zero trust infrastructure exists. |

---

## Slide 2: The Solution — CasperOPs

| | |
|---|---|
| **What** | No-code platform to build, deploy, and manage trustworthy autonomous AI agents on Casper |
| **How** | Visual workflow builder (React Flow) + 19 Casper-native tools + 4 Odra smart contracts providing on-chain accountability |
| **Key innovation** | **x402 payment protocol** — pay-per-call in CSPR via HTTP 402; every tool execution is cryptographically signed, recorded on-chain, and verifiable |
| **Differentiator** | No seed phrases, no EVM bridge, no Lit PKP. Pure Casper-native: CSPR.click wallet + Odra contracts + CSPR.cloud indexing. |

---

## Slide 3: Architecture

```
┌──────────────┐    ┌──────────────────┐    ┌──────────────────┐
│   Browser    │───▶│  Next.js (3000)  │───▶│  Express Backend │
│ (CSPR.click  │    │  + React Flow    │    │  + 19 tools      │
│  + x402)     │    │  + 4 templates   │    │  + x402 middleware│
└──────────────┘    └──────────────────┘    └────────┬─────────┘
                                                     │
                    ┌────────────────────────┐       │
                    │   Casper Testnet        │◄──────┘
                    │   + CSPR.cloud          │
                    │   + 6 Odra contracts    │
                    │   (AgentFactory,        │
                    │    Reputation, Escrow,  │
                    │    Compliance, CEP-18,  │
                    │    CEP-78)              │
                    └────────────────────────┘
                               ▲
                    ┌──────────┴──────────┐
                    │  MCP Server (Python) │◄── n8n / LangGraph / CrewAI
                    │  stdio + HTTP/SSE    │
                    └─────────────────────┘
```

**Key components:**
- **4 pre-built templates**: Yield Optimizer, RWA Verifier, Compliance Guardian, Treasury Executor
- **22 tools**: native CSPR transfers, CEP-18/CEP-78 tokens/NFTs, agent registry, reputation, escrow, compliance, market data
- **x402**: pay-per-call in CSPR — client signs a 1-click payment deploy via CSPR.click, retries with proof-of-payment
- **MCP server**: LangGraph/CrewAI agents discover and call all tools via stdio or HTTP/SSE
- **Telegram bot**: deploy agents, check balances, transfer CSPR, list on-chain agents via inline keyboards

---

## Slide 4: Demo Flow (3 min)

| Step | What happens | User sees |
|---|---|---|
| 1 | Open CasperOPs in browser | Visual canvas with pre-loaded Yield Optimizer template |
| 2 | Connect CSPR.click wallet | Public key appears in header, wallet badge turns green |
| 3 | Drag "register_agent" tool onto canvas, connect to "transfer", click Run | x402 payment popup (0.5 CSPR) |
| 4 | Sign with CSPR.click | Toast shows deploy hash + CSPR.live link |
| 5 | Switch to Telegram bot | `/balance` -> shows CSPR balance, `/agents` -> lists on-chain agents, `/transfer` -> sends CSPR |
| 6 | Open Marketplace tab | Agent grid sorted by Top Rated, "Hire via Escrow" with 5/10 CSPR quick-fill |
| 7 | Deploy a CEP-18 token | Custom token deployed to testnet in seconds |

---

## Slide 5: Team & Roadmap

| | |
|---|---|
| **Team** | Full-stack developers + Rust smart contract engineers. Built the entire Casper-native stack from scratch: Odra contracts, x402 protocol, MCP server, visual builder, Telegram bot. |
| **Current** | v1.0 shipped — 6 Odra contracts (64 tests), 19 tool endpoints, 4 templates, Telegram bot, MCP integration, x402 payment protocol, marketplace with escrow hiring |
| **Next** | Mainnet launch → staking vault agents → cross-chain attestation bridge → DAO-governed agent registry → CEP-18 yield vaults |
| **Why Casper** | CSPR.click wallet is the best UX in crypto — no seed phrases, no EVM complexity. Odra's Rust framework is fast, safe, and Casper-native. Highway consensus enables predictable fees and finality. |

---

## Links

- **GitHub**: https://github.com/your-org/CasperOPs (private during contest)
- **Live demo**: https://casperops.dev (public staging)
- **Telegram bot**: https://t.me/CasperOPsBot
- **Contracts (testnet)**: See `docs/testnet-validation.md`
- **x402 spec**: `docs/x402.md`
