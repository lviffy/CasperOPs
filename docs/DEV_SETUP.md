# Developer Setup

Full developer setup guide for the CasperOPs Casper stack.

## 0. System requirements

| Tool                | Version           | Why                                  |
| ------------------- | ----------------- | ------------------------------------ |
| Node.js             | ≥ 20              | Frontend (Next.js 15) + Backend      |
| npm or pnpm or bun  | any (npm ≥ 10)    | Package manager                      |
| Python              | ≥ 3.11            | MCP server                           |
| Rust                | nightly           | Odra smart contracts                 |
| WABT                | latest            | `wasm-opt`, `wasm-strip`             |
| Casper Wallet       | latest extension  | User-facing wallet                   |
| PostgreSQL          | 14+ (optional)    | Supabase + MCP state                 |
| Redis               | 6+ (optional)     | MCP session state                    |
| Git                 | any               | VCS                                  |

## 1. Clone & install

```bash
git clone https://github.com/your-org/CasperOPs.git
cd CasperOPs

# Install root dev scripts
npm install -g concurrently  # optional, for `./scripts/dev.sh`

# Install all three subprojects
(cd frontend && npm install)
(cd backend && npm install)
(cd n8n_agent_backend && pip install -r requirements.txt)
```

## 2. Toolchain setup

### Rust + Odra

```bash
# Nightly toolchain + wasm target
rustup toolchain install nightly
rustup target add wasm32-unknown-unknown --toolchain nightly
cargo install cargo-odra
```

### WABT (wasm-opt + wasm-strip)

```bash
# Arch Linux
sudo pacman -S wabt

# macOS
brew install wabt

# Or download a release
# https://github.com/WebAssembly/wabt/releases
# Extract to /tmp/wabt-1.0.36/

# Add to PATH (or set WABT_BIN=... in your shell rc)
export PATH="/tmp/wabt-1.0.36/bin:$PATH"
```

## 3. Environment files

```bash
# Frontend
cp frontend/.env.example frontend/.env.local  # if it exists, otherwise create your own

# Backend
cp backend/.env.example backend/.env
# Edit backend/.env: fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET,
# CASPER_RPC_URL, CSPR_CLOUD_API_URL, CSPR_CLOUD_API_KEY, CASPER_SECRET_KEY,
# CASPER_AGENT_FACTORY_HASH, CASPER_REPUTATION_HASH, CASPER_ESCROW_HASH,
# CASPER_COMPLIANCE_HASH, CASPER_CEP18_CONTRACT_HASH, CASPER_CEP78_CONTRACT_HASH,
# CASPER_PAYMENT_RECIPIENT_PUBLIC_KEY

# MCP
cp n8n_agent_backend/.env.example n8n_agent_backend/.env  # if it exists
```

## 4. Build the contracts

```bash
cd contract
export RUSTFLAGS="-C link-arg=--unresolved-symbols=import-dynamic"
cargo test                # 24 unit tests
cargo odra build          # → wasm/AgentFactory.wasm, …, wasm/Cep78Nft.wasm
```

## 5. Deploy to Casper testnet (one-time)

```bash
# 5.1 Generate a funded ed25519 signer
cd contract
node scripts/generate-signer.js
# → backend/secrets/testnet-signer.{pem,json} (gitignored)

# 5.2 Fund the public key from the faucet
#    https://testnet.cspr.live/tools/faucet?account=<your-public-key>
#    Wait ~30s for the funding to land.

# 5.3 Set CASPER_SECRET_KEY in backend/.env
#     Use the value printed by generate-signer.js (no 0x prefix).

# 5.4 Deploy all 6 contracts
node scripts/deploy.js
# → prints 6 contract hashes. Copy them into backend/.env:
#    CASPER_AGENT_FACTORY_HASH, CASPER_REPUTATION_HASH, CASPER_ESCROW_HASH,
#    CASPER_COMPLIANCE_HASH, CASPER_CEP18_CONTRACT_HASH, CASPER_CEP78_CONTRACT_HASH
```

## 6. Run the dev stack

```bash
# Option A: one command
./scripts/dev.sh up

# Option B: three terminals
(cd backend && npm run dev)                # http://localhost:3000/api
(cd frontend && npm run dev)               # http://localhost:3000
(cd n8n_agent_backend && uvicorn mcp_server_sse:app --reload --port 8080)
# MCP server: http://localhost:8080/mcp
```

## 7. Run the e2e test

```bash
# Re-run the canonical agent lifecycle on testnet
./scripts/e2e-testnet.sh --skip-deploy
```

Output is appended to `docs/testnet-validation.md`.

## 8. Run the test suites

| Suite     | Command                                | What it does                                |
| --------- | -------------------------------------- | ------------------------------------------- |
| Contract  | `cd contract && cargo test`            | 24 Odra unit tests                          |
| Frontend  | `cd frontend && npm test`              | 25 vitest unit tests (wallet, error mapper) |
| Backend   | `cd backend && npm run test:unit`      | x402 middleware + TOOL_PRICING               |
| Coverage  | `cd frontend && npm run coverage`      | vitest coverage (HTML report)                |
| Coverage  | `cd backend && npm run coverage`       | c8 coverage (HTML report)                   |

## 9. Set up Supabase

1. Create a new Supabase project.
2. Run the migration in `supabase/migrations/20260622_casper_schema.sql`
   via the Supabase SQL editor.
3. Copy the project URL + anon key + service role key into
   `backend/.env` (and `frontend/.env.local` for the public ones).
4. (Optional) Run `node scripts/backfill-csprclick-users.js --dry-run`
   to preview which users need to re-connect via CSPR.click. Drop
   `--dry-run` to perform the migration.

## 10. Set up CSPR.cloud (optional, for higher rate limits)

1. Create an account at <https://cspr.cloud>.
2. Copy the bearer token into `backend/.env` as `CSPR_CLOUD_API_KEY`.
3. Without the key, CSPR.cloud limits you to 60 req/min.

## 11. Set up Redis + Postgres for the MCP server (optional)

```bash
# Local
docker run -d -p 6379:6379 redis:7
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16

# Or use managed services
#   Upstash Redis → REDIS_URL=redis://default:<password>@<host>:<port>
#   Neon Postgres → POSTGRES_DSN=postgres://<user>:<password>@<host>/<db>
```

The MCP server runs without them (stateless), but you lose tool-call
history and session metadata.

## 12. Git hooks (optional)

The repo ships with a `pre-commit` config that runs `cargo clippy`,
`cargo test`, and `next lint` on changed files. Install it with:

```bash
pip install pre-commit
pre-commit install
```

## 13. Troubleshooting

See [`docs/TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) for common issues
and their fixes.

## 14. Contributing

- Branch off `main`.
- Keep PRs focused (one feature/fix per PR).
- Add tests for any new code path.
- Run the full test suite + lints before pushing.
- Update the relevant doc (`docs/ARCHITECTURE.md`, `docs/API.md`, etc.).
