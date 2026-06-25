# Casper Testnet Deployment Guide

This document covers deploying the BlockOps Odra smart contracts to Casper Testnet.

## Prerequisites

### 1. Rust + Odra toolchain
```bash
rustup toolchain install nightly
rustup target add wasm32-unknown-unknown --toolchain nightly
cargo install cargo-odra
```

### 2. WABT (for `wasm-opt` and `wasm-strip`)
```bash
# Arch Linux
sudo pacman -S wabt

# Or download a release:
# https://github.com/WebAssembly/wabt/releases
```

### 3. Testnet account (CSPR)
1. Install the [Casper Wallet](https://www.casperwallet.io/) or use [CSPR.click](https://cspr.click/).
2. Switch the wallet to **Testnet**.
3. Fund it from the [Casper Testnet Faucet](https://testnet.cspr.live/tools/faucet).
4. Export the **secret key** (hex) — this is what `CASPER_SECRET_KEY` holds.

### 4. RPC + Explorer endpoints
- Testnet RPC: `https://rpc.testnet.casper.live/rpc`
- CSPR.cloud: `https://api.testnet.cspr.cloud` (optional, faster indexing)
- Testnet Explorer: `https://testnet.cspr.live`

## Building the WASM contracts

From the repo root:

```bash
cd contract

# Required: allow unresolved wasm imports (host functions are provided at deploy time)
export RUSTFLAGS="-C link-arg=--unresolved-symbols=import-dynamic"
export PATH="/path/to/wabt/bin:/opt/dart-sdk/bin/utils:$PATH"

cargo odra build
```

Outputs:
```
contract/wasm/AgentFactory.wasm
contract/wasm/Reputation.wasm
contract/wasm/Escrow.wasm
contract/wasm/Compliance.wasm
```

Each contract exposes: `init`, `call`, and a `migrate_events` upgrade hook.

## Deploying with the BlockOps backend

The `backend/services/contractDeploymentService.js` already wraps `casper-js-sdk` and handles CEP-18 / CEP-78 deploys using the WASM files above.

Set the following environment variables in `backend/.env`:

```env
CASPER_RPC_URL=https://rpc.testnet.casper.live/rpc
CASPER_SECRET_KEY=<hex secret key from wallet>
CASPER_AGENT_FACTORY_HASH=<hash after deploy>
CASPER_REPUTATION_HASH=<hash after deploy>
CASPER_ESCROW_HASH=<hash after deploy>
CASPER_COMPLIANCE_HASH=<hash after deploy>
```

### Manual deploy (casper-client)

If you prefer `casper-client`:

```bash
# AgentFactory (no constructor args)
casper-client put-deploy \
  --node-address https://rpc.testnet.casper.live/rpc \
  --secret-key-path /path/to/secret_key.pem \
  --chain-name casper-test \
  --payment-amount 200000000000 \
  --session-path contract/wasm/AgentFactory.wasm

# Reputation (validator_address arg)
casper-client put-deploy \
  --node-address https://rpc.testnet.casper.live/rpc \
  --secret-key-path /path/to/secret_key.pem \
  --chain-name casper-test \
  --payment-amount 200000000000 \
  --session-path contract/wasm/Reputation.wasm \
  --session-arg "validator_address:account_hash='<hex>'"

# Escrow (backend, treasury)
casper-client put-deploy \
  --node-address https://rpc.testnet.casper.live/rpc \
  --secret-key-path /path/to/secret_key.pem \
  --chain-name casper-test \
  --payment-amount 200000000000 \
  --session-path contract/wasm/Escrow.wasm \
  --session-arg "backend:account_hash='<hex>'" \
  --session-arg "treasury:account_hash='<hex>'"

# Compliance (authority)
casper-client put-deploy \
  --node-address https://rpc.testnet.casper.live/rpc \
  --secret-key-path /path/to/secret_key.pem \
  --chain-name casper-test \
  --payment-amount 200000000000 \
  --session-path contract/wasm/Compliance.wasm \
  --session-arg "authority:account_hash='<hex>'"
```

## Running the tests

```bash
cd contract
cargo test
```

24 unit tests cover:
- `AgentFactory`: deployment counting, ownership tracking, edge cases.
- `Reputation`: validator gating, rating updates, per-agent stats.
- `Escrow`: deposit / payout / refund, authority checks, balance accumulation.
- `Compliance`: attestation, revocation, default state.

## Verifying a deploy on testnet

After a deploy, copy the deploy hash from the CLI output and open:

```
https://testnet.cspr.live/deploy/<deploy_hash>
```

You should see a green checkmark once the block is finalized (~90 seconds on testnet).
