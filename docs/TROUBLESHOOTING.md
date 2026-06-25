# Troubleshooting

Common issues + fixes for the BlockOps Casper stack.

## Frontend

### `next build` fails with "Missing Supabase environment variables"

The build runs page-data collection which touches `app/api/payments/*`
routes. Provide placeholder env vars:

```bash
cd frontend
NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder_anon_key \
SUPABASE_SERVICE_ROLE_KEY=placeholder_service_role \
JWT_SECRET=placeholder_secret \
npx next build
```

### `CSPR.click SDK not available`

The browser hasn't loaded `@make-software/csprclick-core-client` yet.
Wait for `app/providers.tsx` to mount, or call `initCsprClick()` after
the user clicks "Connect Wallet".

### `user_rejected_sign` keeps appearing

The user closed the Casper Wallet popup without signing. This is a
normal user action — show a friendly "cancelled" toast, do not crash
the workflow.

### Deploy stays in "pending" forever

Possible causes:

1. The deployer has 0 CSPR. Check `wallet_readiness` and the faucet link.
2. The deploy has invalid args. Compare against the schema in
   [`docs/API.md`](./API.md).
3. RPC is slow. The `DeployStatusIndicator` polls for 2 min before
   giving up; check the explorer manually at
   `https://testnet.cspr.live/deploy/<hash>`.

## Backend

### `Missing Supabase environment variables`

Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `backend/.env`.
Copy `backend/.env.example` to get started.

### `EADDRINUSE :::3000`

The Express server is already running. Run `lsof -i :3000` and kill the
existing process, or change the `PORT` env var.

### `x402 verification RPC failed`

The backend couldn't reach the Casper RPC. Check `CASPER_RPC_URL` and
the testnet status page: <https://testnet.cspr.live/status>.

### x402 cache stale

`backend/middleware/x402-verify.js` caches verified deploys for 5 min.
If you need to re-verify a deploy that was already used, restart the
backend (or call `clearX402Cache()` in a route).

### `Cep18Token.wasm` not found

The Odra WASM binaries live in `contract/wasm/`. If they're missing:

```bash
cd contract
export RUSTFLAGS="-C link-arg=--unresolved-symbols=import-dynamic"
cargo odra build
```

## Contracts

### `cargo odra build` fails with `linker stderr: dynamic imports are not yet stable`

Set the env var `RUSTFLAGS="-C link-arg=--unresolved-symbols=import-dynamic"`.
The Casper host functions (`casper_read`, `casper_write`, …) are resolved
at deploy time, not link time.

### `wasm-opt: command not found`

Install WABT and put it on `PATH`:

```bash
# Arch Linux
sudo pacman -S wabt
# macOS
brew install wabt
```

Or set `WABT_BIN=/path/to/wabt-1.0.36/bin` in your environment.

### Deploy reverts with `InvalidDeploy`

The deploy is malformed. Check the entry-point args against the contract
source in `contract/src/*.rs`. Common gotchas:

- `String` args must use `CLValueBuilder.string(...)`, not raw hex.
- `U256` / `U512` amounts must be passed as decimal strings.
- `Address` is the deployer's public key (`CLValueBuilder.key(pk)`).

### Deploy hangs in `pending` after 2 min

Check the deployer balance:

```bash
curl -s https://api.testnet.cspr.cloud/accounts/<DEPLOYER_PK>/balance
```

If the balance is 0, fund it from the testnet faucet:
<https://testnet.cspr.live/tools/faucet>.

## MCP server

### `mcp_server_sse.py` fails to start

Make sure the new dependencies are installed:

```bash
cd n8n_agent_backend
pip install -r requirements.txt
```

Then run with `uvicorn mcp_server_sse:app --reload`.

### `redis.exceptions.ConnectionError`

`REDIS_URL` is not set or Redis isn't running. The MCP server falls
back to stateless operation; the tool-call history will not be
persisted.

### `asyncpg.exceptions.InvalidPasswordError`

`POSTGRES_DSN` is wrong. The server falls back to stateless operation.

## CI

### `cargo test` fails with `linker not found: rust-lld`

Install the `wasm32-unknown-unknown` target:

```bash
rustup target add wasm32-unknown-unknown --toolchain nightly
```

### `npm audit` reports vulnerabilities

Run `npm audit fix` to auto-resolve; for breaking changes, pin
specific versions in `package.json` and add a comment explaining the
constraint.

### Frontend build fails in CI but passes locally

The CI env uses `node-version: 20` and the latest stable `npm`. Check
that you haven't introduced a Node-version-specific API. The
`engines.node = ">=20"` constraint is enforced in CI.

## Testnet

### Faucet claim rejected

The Casper testnet faucet is rate-limited (one claim per public key per
24 hours, max 200 CSPR). Reuse the same key across deploy runs.

### RPC `429 Too Many Requests`

Either slow down your requests or use a CSPR.cloud bearer token
(`CSPR_CLOUD_API_KEY`). Get one at <https://cspr.cloud>.

### Deploy cost higher than expected

The 250 CSPR payment is the standard deploy cost. Add a `cost_motes`
check after the deploy is finalized to track the actual cost.
