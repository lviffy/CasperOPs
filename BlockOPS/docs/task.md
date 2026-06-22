# BlockOps Casper Migration Checklist

This checklist tracks the remaining tasks to fully migrate the BlockOps codebase to the Casper Network.

## Phase 1: Smart Contract Validation & Deployment
- [ ] Write units tests for Odra contracts (`contract/src/agent_factory.rs`, `contract/src/reputation.rs`, `contract/src/escrow.rs`, `contract/src/compliance.rs`)
  - [ ] Execute `cargo test` inside `contract/` to verify business logic
- [ ] Build contracts to WASM using Odra build tool:
  - [ ] Setup/run `cargo odra build` or `odra build`
- [ ] Document/prepare Casper testnet deployment keys and deploy scripts

## Phase 2: Backend API Cleanup & Casper Alignment
- [ ] Refactor or clean up `backend/utils/chains.js` to remove Arbitrum/Flow toolsets and define Casper-supported tools
- [ ] Refactor `backend/services/contractDeploymentService.js` to deploy CEP-18 tokens and CEP-78 NFTs instead of Solidity source compilation
- [ ] Clean up or deprecate EVM-specific services:
  - [ ] `backend/services/litPkpService.js` (EVM private key management)
  - [ ] `backend/services/filecoinStorageService.js` (if Filecoin is no longer used for Casper RWA uploads)
- [ ] Update backend environment variables in `backend/.env.example` (add `CASPER_RPC_URL`, keys, and Odra contract hashes)
- [ ] Install node dependencies in `backend/` and run basic smoke tests on API endpoints:
  - [ ] Native CSPR transfers
  - [ ] Token/NFT deployments

## Phase 3: Frontend Visual Builder & Wallet Connect
- [ ] Refactor `frontend/components/node-library.tsx` to include Casper-native workflow nodes (e.g., CSPR Transfer, CEP-18 Deploy, CEP-78 Deploy, Yield Rebalance, Attest Agent)
- [ ] Update `frontend/components/workflow-builder.tsx` to use `@csprclick/sdk` for session management and signing deploys
- [ ] Install node dependencies in `frontend/` and build next.js application to check for compile-time errors

## Phase 4: AI Workflow & MCP Server Integration
- [x] Implement `n8n_agent_backend/mcp_server.py` to expose Casper RPC/CSPR.cloud context to LangGraph/CrewAI agents
- [ ] Refactor backend tool routing (`backend/services/toolRouter.js` and `backend/services/directToolExecutor.js`) to target the Casper JS SDK instead of EVM ethers/viem calls

## Phase 5: Verification & End-to-End Testing
- [ ] Perform integration test of frontend wallet connect -> Casper workflow assembly -> backend API execution
- [ ] Document final walkthrough and verify deployment on Casper Testnet explorer
