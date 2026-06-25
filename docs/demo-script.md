# BlockOps Demo Walkthrough (3 min)

## Opening (0:00–0:15)
> *Screen: browser at https://blockops.dev*

"Hi, I'm [name]. BlockOps is a no-code platform for building trustworthy autonomous AI agents on the Casper Network. Let me show you how it works."

## 1. Visual Builder + Templates (0:15–0:45)
> *Screen: canvas shows pre-loaded Yield Optimizer template*

"This is the visual workflow builder. When you first open it, the Yield Optimizer template is pre-loaded — a sequence of tools that monitors and rebalances a DeFi position across CEP-18 tokens."

> *Click dropdown, select "RWA Verifier"*

"There are four pre-built templates: Yield Optimizer, RWA Verifier, Compliance Guardian, and Treasury Executor. Each is a drag-and-drop workflow of Casper-native tools."

> *Drag "register_agent" onto canvas, connect an edge*

"You can also build your own by dragging tools onto the canvas and connecting them."

## 2. Connect Wallet + x402 Payment (0:45–1:15)
> *Screen: click "Connect Wallet" → CSPR.click popup*

"To execute a workflow, connect with CSPR.click — Casper's best wallet. No seed phrases, no EVM bridge, just one click."

> *Click Run on a tool → 402 popup appears → Click "Pay 0.5 CSPR"*

"When you run a paid tool, the backend responds with HTTP 402 — a payment challenge. One click signs a 0.5 CSPR payment via CSPR.click. The deploy broadcasts to the testnet."

> *Toast shows deploy hash + CSPR.live link*

"A toast surfaces the deploy hash with a link to CSPR.live so you can verify the transaction on-chain."

## 3. Marketplace + Escrow (1:15–1:45)
> *Screen: navigate to /marketplace*

"The marketplace lists all registered agents sorted by reputation score. Each agent shows its rating, how many times it's been used, and what tools it offers."

> *Click "Hire via Escrow" → modal with 5/10 CSPR quick-fill → confirm*

"You can hire any agent via escrow. The CSPR is held in the Escrow smart contract until the work is complete. This is how BlockOps makes autonomous agents trustworthy — the funds are only released when both parties agree."

> *Green "Escrow Active" badge + CSPR.live link*

"Once the escrow deploy confirms, a badge appears with a link to verify the escrow contract on-chain."

## 4. Telegram Bot (1:45–2:15)
> *Screen: switch to Telegram app*

"BlockOps also has a Telegram bot for quick actions."

> *Type /balance → shows CSPR balance*

"`/balance` — check your CSPR balance instantly."

> *Type /transfer 01... 10 → shows deploy hash*

"`/transfer` — send CSPR to any address. Returns the deploy hash with a CSPR.live button."

> *Type /agents → lists on-chain agents*

"`/agents` — list all agents registered on the AgentFactory contract."

"Every command response has inline buttons for one-tap next actions."

## 5. Architecture Close (2:15–3:00)
> *Screen: architecture diagram from pitch deck*

"Under the hood, BlockOps is built on:
- **6 Odra smart contracts** on Casper testnet — AgentFactory, Reputation, Escrow, Compliance, CEP-18, CEP-78
- **19 Casper-native tool endpoints** with x402 pay-per-call pricing
- **MCP server** so LangGraph/CrewAI agents can use all tools via stdio or HTTP/SSE
- **Telegram bot** for on-the-go agent management

The result: a complete no-code platform where autonomous agents are accountable, transactions are verifiable, and users never give up custody of their keys."

> *End screen: https://blockops.dev | GitHub QR code*

"Check it out at blockops.dev. Thanks for watching!"

---

## Recorded deploy hashes (live demo reference)
| Action | Deploy Hash |
|---|---|
| Wallet connect | — (no on-chain tx) |
| Register agent | `hash-...` |
| CSPR transfer | `hash-...` |
| Escrow deposit | `hash-...` |
| CEP-18 deploy | `hash-...` |

*(Fill in after live test run)*

## Fallback screenshots to capture
1. Yield Optimizer template on canvas
2. x402 payment popup (0.5 CSPR challenge)
3. Toast with CSPR.live link after deploy
4. Marketplace with "Top Rated" sort + "Hire via Escrow" button
5. Escrow modal with 5/10 CSPR quick-fill
6. Telegram bot: /balance response → /transfer response → /agents list
7. Architecture diagram
