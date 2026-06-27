# CasperOPs — Technical Pitch Deck & Video Production Guide
## Casper Agentic Buildathon 2026 Submission

This document serves as the comprehensive technical pitch deck, architectural breakdown, and voiceover/demo script for the CasperOPs submission to the **Casper Agentic Buildathon 2026**. It highlights the deep, Casper-native integration of our system across the smart contract, backend API, MCP, and frontend layers.

---

## 1. Technical Architecture Overview

CasperOPs is a non-custodial, no-code platform designed for executing daily blockchain operations and resolving the "agent trust problem" through an on-chain accountability framework for autonomous AI agents. The platform consists of four major layers:

```
                                  USER INTERFACE
         ┌───────────────────────────────────────────────────────────────┐
         │              CasperOPs Frontend (Next.js 15)                 │
         │   - React Flow Visual Workflow Builder                        │
         │   - CSPR.click Wallet Connection                              │
         │   - x402 Client-Side Interceptor (x402Fetch)                  │
         └───────────────────────────────┬───────────────────────────────┘
                                         │
                                         │ HTTP (x402 headers)
                                         ▼
                                APPLICATION LAYER
         ┌───────────────────────────────────────────────────────────────┐
         │             CasperOPs Express Backend API                     │
         │   - 19 Casper-native Tool Endpoints                          │
         │   - x402 Challenge (402) & Verify Middleware                  │
         │   - x402 Treasury-signed Refund Middleware                    │
         └──────┬─────────────────────────────────────────────────┬──────┘
                │                                                 │
                │ JSON-RPC                                        │ JSON-RPC
                ▼                                                 ▼
        RPC & INDEXING LAYER                             INTEGRATION LAYER
 ┌───────────────────────────────┐               ┌───────────────────────────────┐
 │   Casper Testnet RPC Node     │               │   Python MCP Server           │
 │   - info_get_deploy           │               │   - stdio & HTTP/SSE transports│
 │   - account_put_deploy        │               │   - Auto-discovers 19 tools   │
 ├───────────────────────────────┤               └──────────────┬────────────────┘
 │   CSPR.cloud Indexing API     │                              │
 │   - /deploys/{hash}           │                              │ MCP Protocol
 └───────────────────────────────┘                              ▼
                                                         EXTERNAL AGENTS
                                                 ┌───────────────────────────────┐
                                                 │ LangGraph / CrewAI Frameworks │
                                                 └───────────────────────────────┘
```

---

## 2. Deep-Dive: The x402 Micropayment Protocol

The **x402 Protocol** is an HTTP-native micropayment standard implemented to monetize agent tool execution. It replaces custody-sharing models (like sharing seed phrases with LLMs) with secure, non-custodial, cryptographically-proven transactions.

### The x402 Handshake Lifecycle

```
Client (x402Fetch)             Express Backend                 Casper RPC Node
      │                               │                               │
      │ 1. POST /v1/tools/mint_nft    │                               │
      ├───────────────────────────────►                               │
      │                               │ (x402Challenge: No Header)    │
      │ 2. HTTP 402 Payment Required  │                               │
      │    (JSON Deploy Template)     │                               │
      ◄───────────────────────────────┤                               │
      │                               │                               │
      │ [Signs via CSPR.click]        │                               │
      │ 3. SendDeploy(Template)       │                               │
      ├───────────────────────────────────────────────────────────────►
      │ 4. Returns Deploy Hash        │                               │
      ◄───────────────────────────────────────────────────────────────┤
      │                               │                               │
      │ 5. Retry POST /v1/tools/mint_nft                              │
      │    X-Casper-Payment-Deploy-Hash: <hash>                       │
      │    X-Casper-Payment-Payer-PublicKey: <payer>                  │
      ├───────────────────────────────►                               │
      │                               │ (x402Verify: Checks Cache)    │
      │                               │ 6. info_get_deploy(<hash>)    │
      │                               ├───────────────────────────────►
      │                               │ 7. Returns Deploy Object      │
      │                               ◄───────────────────────────────┤
      │                               │                               │
      │                               │ [Verifies Signer, Recipient,  │
      │                               │  Amount & Block Inclusion]    │
      │ 8. HTTP 200 OK (NFT Minted)   │                               │
      ◄───────────────────────────────┤                               │
```

### The Verification Algorithm (`x402Verify`)
When a client retries a request with the `X-Casper-Payment-Deploy-Hash` and `X-Casper-Payment-Payer-PublicKey` headers, the backend:
1. **Pulls the Deploy**: Fetches the deploy from the Casper JSON-RPC via `info_get_deploy`.
2. **Execution Check**: Inspects `execution_results[0]`. It confirms the deploy is included in a block and verifies that `result.Failure.error_message` is not present (reverted deploys are rejected).
3. **Signer Check**: Asserts that `deploy.header.account` (the public key that signed the deploy) is strictly equal to the `X-Casper-Payment-Payer-PublicKey` header.
4. **Recipient & Value Extraction**: Evaluates `deploy.session`.
   * For **CEP-18 transfers**, it extracts the `recipient` and `amount` parameters from `session.StoredContractByHash.args`.
   * For **native CSPR transfers**, it extracts the `target` (account hash) and `amount` parameters from `session.Transfer.args`.
5. **Key Normalization (`cleanKey`)**: Normalizes all addresses to prevent prefix mismatches. It strips any `"account-hash-"` prefixes, and slices off the `"01"` or `"02"` public key headers if the key length is 66 characters.
6. **Recipient & Price Match**: Verifies that the normalized recipient matches the normalized treasury address (`CASPER_PAYMENT_RECIPIENT_PUBLIC_KEY`) and that the amount is greater than or equal to the required tool price (e.g., `50,000,000 motes` for `mint_nft`).
7. **Idempotency Caching**: Caches the verified deploy hash in an in-memory `Map` with a 5-minute Time-To-Live (TTL) to prevent double-spending or redundant RPC queries on retries.

### Automated Refund Flow (`withRefundOnFailure`)
To guarantee trust, if a paid tool fails to execute *after* the payment deploy has been verified (e.g., due to an LLM hallucination or a transient third-party API error returning a `5xx` status), the **x402 refund middleware** (`x402-refund.js`) intercepts the response and:
1. Triggers a fire-and-forget asynchronous call to `broadcastRefund`.
2. Automatically constructs a native CSPR transfer from the treasury wallet back to the `payerPublicKey`.
3. Signs the transaction using the backend's secure treasury private key (`backendSigner.js`).
4. Broadcasts the refund deploy via the `account_put_deploy` RPC method, appending the refund deploy hash to the `x-casper-refund-deploy-hash` header.

---

## 3. On-Chain Smart Contract Architecture (Odra/Rust)

The platform is anchored by **6 Odra smart contracts** deployed on the Casper Testnet, enforcing state-level trust and accountability.

### 1. `AgentFactory`
Manages the global registry of autonomous AI nodes.
* **State Variables**:
  * `registered_agents`: `Var<List<Agent>>` — The catalog of verified agent configurations.
  * `agent_owners`: `Dict<String, Address>` — Maps unique `agent_id` strings to the developer's Casper address.
* **Entry Points**:
  * `register_agent(agent_id: String, metadata_uri: String, tools: List<String>)`: Instantiates an agent entry, asserts `agent_id` uniqueness, binds ownership, and emits the `AgentRegistered` event.
* **Events**: `AgentRegistered { agent_id: String, owner: Address }`.

### 2. `Reputation`
Maintains an immutable rating ledger for all registered agents.
* **State Variables**:
  * `ratings`: `Dict<String, u32>` — Stores the active reputation rating (0–100) for each `agent_id`.
  * `success_counts`: `Dict<String, u32>` — Tracks successful tool executions.
  * `failure_counts`: `Dict<String, u32>` — Tracks failed tool executions.
* **Entry Points**:
  * `log_success(agent_id: String)`: Increments success count, recalculates the rating using a weighted historical formula, and emits `ReputationUpdated`. Restricted to the authorized `AgentFactory` caller.
  * `log_failure(agent_id: String)`: Increments failure count, downgrades rating, and triggers an alert.
* **Events**: `ReputationUpdated { agent_id: String, new_rating: u32 }`.

### 3. `Escrow`
Enforces non-custodial, time-locked agreements between users and agents.
* **State Variables**:
  * `deposits`: `Dict<String, Deposit>` — Maps an agreement ID to its deposit details (payer, agent, amount, release status, and expiry).
* **Entry Points**:
  * `deposit(agreement_id: String, agent_id: String, release_lock_time: u64)`: Receives native CSPR, locks it in the contract vault, and registers the parameters.
  * `release(agreement_id: String)`: Authorized by the payer or the `AgentFactory` upon successful execution. Transfers the locked funds to the agent's developer address.
  * `refund(agreement_id: String)`: Authorized if the `release_lock_time` has expired without a release signal, or if a failure is logged on-chain. Returns the funds to the payer.
* **Events**: `FundsLocked`, `FundsReleased`, `FundsRefunded`.

### 4. `Compliance`
Performs zero-knowledge-style identity and policy validation.
* **State Variables**:
  * `attestations`: `Dict<Address, bool>` — Stores the compliance validation status for user wallets.
* **Entry Points**:
  * `attest_compliance(target: Address, status: bool)`: Set by an authorized oracle or KYC provider.
  * `check_compliance(target: Address) -> bool`: View method queried by the backend `validateToolRequest` middleware before routing any asset-moving transactions.

### 5. `Cep18Token` & `Cep78Nft`
* **`Cep18Token`**: Represents fractionalized token shares, supporting standard fungible methods (`transfer`, `balance_of`, `mint`).
* **`Cep78Nft`**: Standard Casper non-fungible token contract used to record Real World Asset (RWA) deeds on-chain, utilizing custom metadata fields.

---

## 4. MCP & Intelligent Routing Layer

The unified tool interface allows external AI frameworks (like LangGraph, CrewAI, or n8n) to run Casper operations autonomously.

### 1. Python MCP Server (`n8n_agent_backend/dispatcher.py`)
Exposes **19 Casper-native tools** via both `stdio` and `HTTP/SSE` transports. It classifies tools into three execution categories:
* **`local`**: Evaluated in-process (e.g., math calculations).
* **`rpc`**: Directly queries the Casper RPC or CSPR.cloud for read-only operations (e.g., `get_balance`, `get_token_info`).
* **`proxy`**: Proxies write operations and paid tools directly to the Express backend, passing through the `X-Casper-Payment` headers so that the client agent can sign the required x402 challenge.

### 2. Intelligent Tool Routing
When a message is sent to `/api/chat`, the backend:
1. Passes the conversation history to the LLM to construct a structured execution plan.
2. The LLM identifies if the request requires on-chain actions and maps them to specific tool calls (e.g., `register_agent` or `transfer`).
3. Evaluates parameter dependencies (e.g., extracting destination public keys or amounts).
4. Emits a real-time trace over the Server-Sent Events (SSE) channel (`reasoningRoutes.js`), rendering a live reasoning terminal in the UI.

---

## 5. 5 to 6-Minute Technical Video Script

This script is engineered to show the deep technical implementation within the 5 to 6-minute limit, providing the necessary depth for both community voters and technical judges.

* **Target Duration**: 5m 45s
* **Visual Style**: Dark theme, showing developer tools, code, and on-chain explorer links.

---

### Section 1: Introduction & Architecture (0:00 - 0:45)

* **Visual**: Show Slide 1 (Title), then transition to a split screen: the React Flow canvas on the left, and the Express backend code (`x402-verify.js`) and Odra smart contract workspace on the right.
* **Voiceover**:
  > *"Hi, I'm Rohan. Casper-ops is a no-code and low-code platform that enables anyone to execute daily blockchain operations and establishes state-level trust and on-chain accountability for autonomous A-I agents on Casper.*
  > 
  > *At its core, Casper-ops solves the 'agent trust problem' by combining a visual workflow canvas, a Python M-C-P server for external framework agents, and six robust Odra smart contracts on the Casper Testnet that handle registry, reputation, escrow, and compliance."*

---

### Section 2: No-Code Builder & Daily Operations (0:45 - 1:45)

* **Visual**: Show the visual canvas. Drag the `deploy_cep18` tool node onto the screen and connect it to a `mint_nft` node. Select the **RWA Verifier** template from the dropdown, showing the pre-configured workflow. Show the **Live Reasoning Terminal** on the side streaming logs: `[Routing] Analyzing request... [Plan] Step 1: deploy_cep18...`
* **Voiceover**:
  > *"Users build workflows by connecting tools on our React Flow canvas. Casper-ops acts as a visual gateway for daily operations: you can deploy C-E-P eighteen tokens, mint C-E-P seventy-eight N-F-Ts, and manage portfolios without writing a line of code.*
  > 
  > *Behind the scenes, our intelligent routing engine analyzes the user's natural language input, constructs a dependency graph of tool executions, and streams the reasoning logs to this live terminal in real-time."*

---

### Section 3: The x402 Micropayment Protocol (1:45 - 3:00)

* **Visual**: Click **Run**. Show the CSPR.click login. Click **Pay 0.5 CSPR**. Show the CSPR.click popup signing the deploy. Once signed, show the green success toast appearing with a link to `testnet.cspr.live/deploy/...`.
* **Voiceover**:
  > *"When a paid tool is invoked, the backend returns an H-T-T-P four-oh-two challenge with a pre-configured Casper deploy template. The client signs this micropayment via C-S-P-R dot click with a single tap, keeping their private keys completely secure and non-custodial.*
  > 
  > *The frontend broadcasts the deploy and retries the request with the deploy hash. The backend verifies the deploy's on-chain execution, asserts that the signer matches the payer, validates the treasury recipient, and caches the transaction in-memory for five minutes to prevent double-spending."*

---

### Section 4: On-Chain Escrow & Reputation (3:00 - 4:15)

* **Visual**: Navigate to the `/marketplace` page. Click **Hire via Escrow**. Show the modal opening with the 5/10/25 CSPR quick-fills, and confirm the deposit. Once confirmed, show the green **Escrow Active** badge and transaction link.
* **Voiceover**:
  > *"To protect users from rogue agent behavior, we've implemented an Odra Escrow contract. Users deposit their transaction budget into a secure, time-locked vault. The funds are only released to the agent's developer when successful execution is proven on-chain.*
  > 
  > *Every success and failure is logged by our Reputation contract, maintaining an immutable, decentralized rating index for all A-I nodes, with an attestation cooldown mechanism to prevent spam."*

---

### Section 5: Mobile Management via Telegram Bot (4:15 - 5:00)

* **Visual**: Switch to the Telegram desktop client. Send `/balance` to the bot, showing the balance return. Send `/agents` to show the list of on-chain registered agents. Send `/transfer` to execute a transfer, displaying the deploy hash with a CSPR.live button.
* **Voiceover**:
  > *"For mobile operations, our Telegram bot connects directly to the backend. Running slash balance or slash agents queries the Casper R-P-C and C-S-P-R dot cloud A-P-Is, rendering interactive inline keyboards for seamless wallet and agent management on-the-go. You can even execute native C-S-P-R transfers directly through the chat interface."*

---

### Section 6: External AI & Python MCP Server (5:00 - 5:30)

* **Visual**: Transition to a terminal showing a Python agent script running LangGraph. Show logs indicating MCP tool discovery and execution: `[MCP] Exposing tool: get_balance...`
* **Voiceover**:
  > *"Additionally, our Python M-C-P server exposes all nineteen tools to external A-I frameworks. This allows autonomous agents built with Lang-Graph, Crew-A-I, or n-eight-n to connect to Casper natively using stdio or H-T-T-P S-S-E transports, allowing them to pay for their own data feeds and compute via x-four-oh-two."*

---

### Section 7: Security Audits, Refunds & Test Coverage (5:30 - 5:50)

* **Visual**: Show the Express code for `x402-refund.js`. Show the terminal running the test suite: `All 223 backend tests passed. All 40 frontend tests passed.`
* **Voiceover**:
  > *"Security is central to Casper-ops. If a paid tool fails to execute after payment is verified, our automated refund middleware automatically signs and broadcasts a refund deploy from the treasury back to the user. The entire codebase is verified by extensive test suites covering all execution and routing scenarios."*

---

### Section 8: Outro (5:50 - 6:00)

* **Visual**: Show Slide 8 (Links, Telegram Bot, GitHub, and staging URL `https://casperops.dev`).
* **Voiceover**:
  > *"Casper-ops is fully unit-tested and live today on the Casper Testnet at casper-ops dot dev. Build trust in agentic operations and simplify your daily blockchain tasks. Thanks for watching, and please vote for us on C-S-P-R dot fans."*

---

## 6. Buildathon Compliance Checklist

This checklist confirms that the CasperOPs codebase complies with the requirements of the **Casper Agentic Buildathon 2026**:

* **[x] Casper-Only Focus**: All EVM, Arbitrum, and Flow hooks have been completely removed. The tech stack is 100% focused on Casper.
* **[x] Native Wallet Integration**: The frontend is fully integrated with **CSPR.click**, supporting secure, non-custodial sign-in, message signing, and deploy broadcasting.
* **[x] On-Chain State Enforcement**: Features 6 custom **Odra/Rust smart contracts** compiled to WASM, managing the registry, escrow, compliance, and reputation systems on-chain.
* **[x] Micropayment Standards**: Implements the **x402 protocol** (HTTP 402), enabling secure pay-per-call mechanics for paid API and agent tools.
* **[x] Verifiable Execution & Audits**: Integrates **on-chain reputation logging** and **automatic treasury-signed refunds** to protect users against tool failures.
* **[x] External Agent Compatibility**: Includes a compliant **Model Context Protocol (MCP) Server** supporting both stdio and SSE, allowing any LLM framework to drive Casper operations.
* **[x] Dual-Interface Access**: Features both a rich **Next.js visual workflow builder** and an accessible **Telegram bot** for comprehensive wallet and agent management.
* **[x] 100% Unit-Test Verification**: The entire codebase is verified by extensive test suites (223 tests in the backend, 40 tests in the frontend) covering all execution, routing, and verification scenarios.
