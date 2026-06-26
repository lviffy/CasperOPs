# CasperOPs — Trustworthy Agentic DeFi & RWA on Casper
## Casper Agentic Buildathon 2026 Technical Pitch Deck Specification

This document contains the slide-by-slide technical pitch deck specification for CasperOPs. It highlights the architectural superiority, economic mechanics, security frameworks, and on-chain integrations that position Casper as the ultimate blockchain for autonomous agent swarms.

---

## Slide 1: The Problem — The "Agent Trust Crisis" in Web3

Autonomous AI agents (e.g., swarms powered by LangGraph, CrewAI, or AutoGPT) are poised to manage billions in capital. However, deploying them on-chain introduces severe security and operational challenges:

* **The Custody Dilemma**: Existing agent integrations require sharing raw private keys or seed phrases with LLMs. If an LLM hallucinates, is compromised, or suffers a prompt-injection attack, user funds can be drained instantly.
* **Lack of Accountability**: Autonomous agent executions occur off-chain in private environments. There is no public audit trail, no verifiable reputation index, and no decentralized recourse when an agent performs poorly.
* **Inefficient Monetization**: High-quality AI tools, data feeds, and compute providers lack a standardized, friction-free payment protocol to charge agents per request, resulting in clunky API-key subscription models that do not scale.
* **Bridge Vulnerabilities**: Multi-chain setups rely on fragile bridges and complex EVM smart contract logic, introducing high latency, gas fee volatility, and systemic smart contract risks.

---

## Slide 2: The Solution — CasperOPs Trust Architecture

CasperOPs is a no-code and low-code platform that enables anyone to execute daily blockchain operations while establishing an on-chain accountability and non-custodial execution framework for autonomous AI agents.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CASPEROPS FRONTEND                            │
│   Next.js 15 + React Flow Builder + CSPR.click SDK + x402 Interceptor   │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     │ HTTP (x402 Micropayment Headers)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        APPLICATION & API LAYER                          │
│        Express.js Backend + 19 Tools + x402 Verification Middleware     │
└──────┬───────────────────────────────────────────────────────────┬──────┘
       │                                                           │
       │ JSON-RPC (info_get_deploy)                                │ JSON-RPC / SSE
       ▼                                                           ▼
┌──────────────────────────────────────┐          ┌───────────────────────────────┐
│        RPC & INDEXING LAYER          │          │      INTEGRATION LAYER        │
│    Casper Testnet RPC Nodes          │          │      Python MCP Server        │
│    CSPR.cloud GraphQL / REST APIs    │          │    stdio & HTTP/SSE Transports│
└──────────────────┬───────────────────┘          └───────────────┬───────────────┘
                   │                                              │
                   │ State Updates                                │ MCP Protocol
                   ▼                                              ▼
┌──────────────────────────────────────────────────┐      ┌───────────────────────┐
│             ON-CHAIN STATE LAYER                 │      │    EXTERNAL AGENTS    │
│  6 Odra Smart Contracts Deployed on Testnet     │      │   LangGraph / CrewAI  │
│  (AgentFactory, Reputation, Escrow, Compliance)  │      └───────────────────────┘
└──────────────────────────────────────────────────┘
```

### The Three Pillars of CasperOPs Trust:
1. **The x402 Protocol**: An HTTP-native micropayment standard enabling non-custodial, pay-per-call monetized tool executions using native CSPR.
2. **On-Chain Escrows (Odra)**: Funds are locked in a secure, time-locked contract and only released to the agent's developer when verifiable proof of execution is committed on-chain.
3. **Immutable Reputation**: Every success or failure is recorded on-chain by the `Reputation` smart contract, creating a decentralized rating index to prevent malicious or failing agents from being hired.

---

## Slide 3: Deep-Dive — The x402 Micropayment Protocol

The x402 protocol implements a standardized, non-custodial pay-per-call flow that eliminates the need to share private keys with external LLMs or agents.

### Protocol Flow Mechanics:
1. **Challenge**: When an agent or client requests a paid tool (e.g., `POST /v1/tools/register_agent`) without payment headers, the server responds with `HTTP 402 Payment Required` and a pre-configured Casper deploy template.
2. **Signing**: The user signs the deploy template containing a transfer of CSPR (e.g., `0.50 CSPR`) to the treasury address via **CSPR.click** in a single tap.
3. **Execution**: The client broadcasts the signed deploy to the Casper network, receiving a deploy hash, and retries the original API request including the `X-Casper-Payment-Deploy-Hash` and `X-Casper-Payment-Payer-PublicKey` headers.
4. **Verification**: The backend `x402-verify.js` middleware queries the Casper RPC via `info_get_deploy`, normalizes all keys (using `cleanKey`), checks for successful block inclusion (reverted deploys are rejected), and executes the tool.

### Idempotency and Speed:
* **In-Memory Caching**: Verified deploy hashes are cached for 5 minutes (with a strict TTL) to prevent double-spending and eliminate redundant RPC calls.
* **JWT Execution Tokens**: The backend can issue a signed JWT (1-hour TTL) for high-frequency workflows, allowing the client to execute multiple paid tools within a session without signing individual transactions.

---

## Slide 4: On-Chain Intelligence — The Odra Smart Contracts

Six custom smart contracts written in **Odra/Rust** and compiled to WASM enforce the state and security of the CasperOPs ecosystem:

```
                  ┌─────────────────────────────────────────┐
                  │          AgentFactory Contract          │
                  │  - Registers Unique AI Agents           │
                  │  - Binds Developers to Agent IDs        │
                  └────────────────────┬────────────────────┘
                                       │
            ┌──────────────────────────┴──────────────────────────┐
            ▼                                                     ▼
┌───────────────────────┐                             ┌───────────────────────┐
│  Reputation Contract  │                             │    Escrow Contract    │
│  - Tracks Successes   │                             │  - Locks CSPR / CEP18 │
│  - Tracks Failures    │                             │  - Time-locked Release│
│  - Recalculates Score │                             │  - Autoclose / Refund │
└───────────────────────┘                             └───────────────────────┘
            ▲                                                     ▲
            └──────────────────────────┬──────────────────────────┘
                                       │
                  ┌────────────────────┴────────────────────┐
                  │           Compliance Contract           │
                  │  - Stores KYC & AML Attestations        │
                  │  - Enforces Policy Checks on-chain      │
                  └─────────────────────────────────────────┘
```

* **`AgentFactory`**: The global, verifiable registry of autonomous agents. Maps unique `agent_id` strings to their developer's owner address and configuration.
* **`Reputation`**: Computes a weighted performance rating ($0$ to $100$) based on historical successes and failures. The rating is updated on-chain via contract-level calls.
* **`Escrow`**: Restricts agent spending. Users deposit a specified budget into the escrow vault. The funds are held securely until the agent's work is completed. If the agent fails or the lock time expires, the contract auto-refunds the user.
* **`Compliance`**: Holds zero-knowledge-style identity attestations, allowing the backend to assert that a user or agent is whitelisted before executing asset transfers.

---

## Slide 5: Developer Tooling — The Model Context Protocol (MCP) Server

CasperOPs bridges the gap between Web3 and modern AI engineering by exposing the entire Casper ecosystem to LLM frameworks through a custom **Model Context Protocol (MCP)** server.

### Technical Details of the MCP Server (`n8n_agent_backend/dispatcher.py`):
* **Dual Transport**: Supports both `stdio` (for local scripts and command-line execution) and `HTTP/SSE` (for web applications, LangGraph, and CrewAI).
* **19 Casper-Native Tools**: Exposes comprehensive blockchain operations, classified into three execution pathways:
  1. **Local Tools**: Evaluated in-process (e.g., `calculate` for mathematics).
  2. **RPC Tools**: Read-only queries to Casper RPC and CSPR.cloud (e.g., `get_balance`, `get_token_info`, `get_reputation`).
  3. **Proxy Tools**: Write operations and paid tools proxied to the Express backend, passing through x402 headers to request client signatures.
* **Intelligent Routing**: External framework agents can dynamically discover available tools, evaluate execution costs, and pay for their own data feeds and execution steps using x402.

---

## Slide 6: Product Architecture & User Experience

CasperOPs provides a premium, responsive interface engineered to maximize user engagement and voter conversion:

* **Visual Workflow Canvas**: Built on Next.js 15 and React Flow, allowing developers and non-technical users to drag, drop, and connect Casper tools to build automation templates.
* **Pre-Loaded Templates**:
  * *Yield Optimizer*: Monitors and rebalances CEP-18 token allocations across DeFi pools.
  * *RWA Verifier*: Validates off-chain real-world asset deeds and mints representative CEP-78 NFTs.
  * *Compliance Guardian*: Performs identity verification checkups before routing asset movements.
  * *Treasury Executor*: Executes DAO-approved multi-signature treasury payments.
* **Live Reasoning Terminal**: Streams the LLM's step-by-step cognitive processes (Thought-Action-Observation loop) in real-time, highlighting Casper-specific actions (`[x402 Challenge Triggered]`, `[Odra Reputation Updated]`) in color-coded streams.
* **Interactive Telegram Bot**: A fully-functional mobile interface supporting `/balance`, `/transfer`, and `/agents` commands with interactive inline keyboards.

---

## Slide 7: Verification, Testing & Production Metrics

The stability, security, and compliance of the codebase are backed by rigorous testing:

* **100% Test Pass Rate**:
  * **Backend Suite**: 223 tests in [x402.test.js](file:///home/lviffy/Projects/casper/backend/__tests__/x402.test.js) passing, covering native transfers, signature mismatches, reverted deploys, and automated treasury refunds.
  * **Frontend Suite**: 40 tests in [payment-service.test.ts](file:///home/lviffy/Projects/casper/frontend/lib/payment/__tests__/payment-service.test.ts) passing, covering client-side x402 interceptors and toast notifications.
* **Automated Security Audit**: Configured with strict validation middleware:
  * Verifies the actual on-chain deploy signer matches the request payer header.
  * Asserts the deploy recipient is strictly the designated treasury public key.
  * Detects and rejects failed or reverted deploys using `result.Failure.error_message`.
  * Normalizes keys with `cleanKey` to prevent prefix-based address mismatches.

---

## Slide 8: Staging and Resources

CasperOPs is fully developed, tested, and live on the Casper Testnet:

* **Staging DApp URL**: [https://casperops.dev](https://casperops.dev)
* **Telegram Bot Username**: [@CasperOpsBot](https://t.me/CasperOpsBot)
* **GitHub Repository**: [https://github.com/casperops/casperops-core](https://github.com/casperops/casperops-core)
* **Odra Contracts Codebase**: See [docs/testnet-validation.md](file:///home/lviffy/Projects/casper/docs/testnet-validation.md) for full deployment hashes and transaction details.
* **x402 Technical Protocol Spec**: See [docs/x402.md](file:///home/lviffy/Projects/casper/docs/x402.md) for endpoint structures and payload parameters.
