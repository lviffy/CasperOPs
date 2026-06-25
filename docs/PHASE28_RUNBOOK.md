# Phase 28 — Live Testnet v1.0 Deployment & On-Chain Validation

> **Audience:** the on-call human who owns a funded testnet keypair.
> The Phase 28 script does the heavy lifting; this runbook walks you
> through the **manual steps** the script can't perform for you.

## Why this phase matters

Phases 16 / 17 / 22 are code-complete and `e2e-testnet-phase22.sh --dryrun`
passes against an in-memory mock of the Casper RPC. None of those
phases have been run against a real testnet key. Phase 28 is the
bridge between dryrun-verified code and a real on-chain v1.0 release.

## Pre-flight (do this once)

1. **Generate a fresh ed25519 keypair** dedicated to this release. Do
   NOT reuse a personal key — a testnet key that gets accidentally
   exposed on a public channel should not have funds attached to it.
   ```bash
   mkdir -p backend/secrets
   # Using casper-client (Rust SDK):
   casper-client keygen backend/secrets/testnet-signer.pem
   # Or via openssl + casper-js-sdk:
   node -e "const k=require('casper-js-sdk').Keys.Ed25519.newRandom(); \
            require('fs').writeFileSync('backend/secrets/testnet-signer.pem', \
            k.exportPrivateKeyInPem());"
   ```

2. **Fund via the Casper testnet faucet**: https://testnet.cspr.live/tools/faucet.
   ~1000 CSPR is enough for the 6 deploys + the e2e + the x402 tests.
   Paste the **public key** (NOT the private key) — the faucet drips
   1000 CSPR per request.

3. **Set the env vars** in your local shell (do NOT commit):
   ```bash
   export CASPER_SECRET_KEY=$(cat backend/secrets/testnet-signer.pem \
     | sed -n 's/^-----BEGIN PRIVATE KEY-----//p; s/-----END PRIVATE KEY-----//p' \
     | tr -d '\n' | xxd -r -p | xxd -p -c 64)
   export CASPER_RPC_URL=https://rpc.testnet.casper.live/rpc
   export CSPR_CLOUD_API_URL=https://api.testnet.cspr.cloud
   ```
   Or use `scripts/e2e-testnet-phase28.sh`'s built-in CASPER_SECRET_KEY
   validator to catch a malformed hex early.

4. **Sanity check the faucet drip**: confirm the key has funds before
   starting the deploy.
   ```bash
   node -e "
     const {CasperServiceByJsonRPC, Keys} = require('casper-js-sdk');
     const pk = Keys.Ed25519.loadKeyPairFromPrivateKey(
       require('fs').readFileSync('backend/secrets/testnet-signer.pem')
     ).publicKey;
     const c = new CasperServiceByJsonRPC('$CASPER_RPC_URL');
     c.getAccountBalance(pk.toHex()).then(b => console.log('balance:', b.toString()));
   "
   ```
   You should see a non-zero balance.

## The deploy (one command)

```bash
cd CasperOPs
./scripts/e2e-testnet-phase28.sh --live
```

This deploys the 6 v1.0 contracts (Agent Factory, Reputation, Escrow,
Compliance, CEP-18, CEP-78). On success the script prints the new
contract hashes and **exits** — you have to copy them into your local
`backend/.env` before continuing.

## The verify (after deploying)

```bash
# 1. Copy the new hashes into backend/.env
cat >> backend/.env <<EOF
CASPER_AGENT_FACTORY_HASH=hash-…
CASPER_REPUTATION_HASH=hash-…
CASPER_ESCROW_HASH=hash-…
CASPER_COMPLIANCE_HASH=hash-…
CASPER_CEP18_HASH=hash-…
CASPER_CEP78_HASH=hash-…
EOF

# 2. Re-run, skipping the deploy step, with --full to write the
#    hashes back into .env.example / contracts.ts / schema.json.
./scripts/e2e-testnet-phase28.sh --live --skip-deploy --full
```

The script runs the full 18-step + 12 Phase 22 e2e against the live
RPC. The output goes to `docs/testnet-validation.md`. The script
appends a fresh "Run <timestamp>" section so multiple runs are
preserved.

## The CSPR.cloud event verification

The script does NOT automatically query CSPR.cloud for the
`Attest`, `RevokeAttestation`, `Burn` events — those queries are
manual because they need a CSPR.cloud API key with read access.

```bash
# Pick one of the e2e deploys and look up its events.
curl -fsS -H "Authorization: Bearer $CSPR_CLOUD_API_KEY" \
  "https://api.testnet.cspr.cloud/contracts-events?contract_hash=$CASPER_AGENT_FACTORY_HASH" \
  | jq '.data | length'
```

For each event type, capture:
- First-seen block height
- Last-seen block height (so future runs know where to resume)
- A sample payload (truncate to ~200 chars; paste into the validation doc)

Fill the Event Verification table in `docs/testnet-validation.md`
with these numbers.

## The x402 real-chain payment sequence

The dryrun testnet already exercises the 402 challenge + verify flow,
but only against the in-memory mock. To prove it works on a real
chain:

1. Start the backend with the live env vars:
   ```bash
   cd backend
   node server.js
   ```

2. From the frontend (or via curl) call a paid tool without a payment
   deploy. Capture the 402 challenge body — it should include a valid
   `payToPublicKey` (the backend treasury key).

3. Using CSPR.click, sign the deploy template in the challenge and
   broadcast it. Capture the **payment deploy hash**.

4. Re-call the tool with `X-Casper-Payment-Deploy-Hash: <hash>` set.
   The backend should verify the deploy landed, execute the tool, and
   return 200 with the tool's deploy hash.

5. If the tool returns 5xx (intentionally, for the test), capture the
   **refund deploy hash** from the `x-casper-refund-deploy-hash`
   response header.

Fill the x402 Payment Sequence table in `docs/testnet-validation.md`.

## The bookkeeping (after a successful run)

The `--full` flag writes the hashes into:

- `backend/.env.example` — so the next dev who clones the repo has
  the right defaults
- `frontend/lib/contracts.ts` — so the frontend's contract registry
  matches
- `n8n_agent_backend/tools/schema.json` — so MCP-aware agents can
  route by name

Review the diff (`git diff backend/.env.example frontend/lib/contracts.ts
n8n_agent_backend/tools/schema.json docs/testnet-validation.md`) and
commit it. The commit message should reference the timestamp:
`testnet(v1.0.0-rc.1): promote <6-hash-truncated> deploy hashes`.

## Tag the release

Once everything above is green:

```bash
git tag -s v1.0.0-rc.1 -m "v1.0.0 release candidate 1 (testnet)"
git push origin v1.0.0-rc.1
```

The tag is the input for Phase 29 (Launch Readiness), which switches
the backend to mainnet RPC + CSPR.cloud, deploys to mainnet, and
flips the launch flag in `docs/STATUS.md`.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `Deploy error: insufficient funds` | Faucet didn't drip yet | Wait 60s, retry |
| `Deploy error: invalid chain name` | `CASPER_RPC_URL` points to mainnet | Use `https://rpc.testnet.casper.live/rpc` |
| `Deploy error: contract already exists at hash` | Re-running a deploy | Use `--skip-deploy` after the first run |
| `info_get_deploy returns "Unknown deploy"` | RPC node dropped the deploy | Switch to the backup RPC (`CASPER_RPC_URL_FALLBACK`, see RUNBOOK §4) |
| `Refund deploy never broadcast` | `REFUND_ENABLED=false` or treasury signer missing | Check `CASPER_SECRET_KEY` + set `REFUND_ENABLED=true` |
| `Event query returns 401` | Missing / expired CSPR.cloud API key | Regenerate at https://cspr.cloud/account |

## Cleanup after the run

- **Move the testnet key to cold storage** (password manager + offline
  backup). Don't leave it on a dev box — even testnet keys shouldn't
  leak.
- **Archive the run log**: `cp docs/testnet-validation.md docs/testnet-validation-$(date +%Y%m%d).md`
- **Rotate CSPR.cloud API key** if it was pasted into a CI secret
  during the run.

## What's next

Phase 29 (Launch Readiness) takes the v1.0.0-rc.1 tag and:
- Switches `backend/config/constants.js` to mainnet RPC + CSPR.cloud
- Adds `scripts/deploy-mainnet.sh --dryrun` for a final pre-flight
- Spins up the public docs site
- Flips `docs/STATUS.md` to "🟢 Operational" for every component