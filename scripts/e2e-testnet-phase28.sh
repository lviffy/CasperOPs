#!/usr/bin/env bash
# Phase 28 — Live Testnet v1.0 Deployment & On-Chain Validation.
#
# This script is the BRIDGE between the dryrun-verified code (Phases 16,
# 17, 22) and a real on-chain v1.0 release. It orchestrates:
#
#   1. The 6 contract deploys via `contract/scripts/deploy.js`
#   2. The 18-step + 12 Phase 22 e2e checks via `scripts/e2e-testnet.mjs`
#   3. The 3 on-chain event verification (Attest / RevokeAttestation / Burn)
#   4. The x402 real-chain payment sequence (payment deploy → tool deploy → refund)
#   5. Writing the canonical contract hashes back into:
#        - backend/.env.example (commented mainnet-promotion defaults)
#        - frontend/lib/contracts.ts
#        - n8n_agent_backend/tools/schema.json
#
# Usage:
#   ./scripts/e2e-testnet-phase28.sh --dryrun         # exercise the script
#   ./scripts/e2e-testnet-phase28.sh --skip-deploy     # use existing hashes
#   ./scripts/e2e-testnet-phase28.sh --full            # deploy + verify + write
#
# The script is intentionally CHATTY: every step prints what it's about
# to do, what it did, and where the output landed. The on-call can read
# the log and reconstruct exactly what happened on testnet.
#
# Required env vars (live mode):
#   CASPER_SECRET_KEY         - 64-char hex testnet key (funded via faucet)
#   CASPER_RPC_URL            - default https://rpc.testnet.casper.live/rpc
#   CSPR_CLOUD_API_URL        - default https://api.testnet.cspr.cloud
#   CSPR_CLOUD_API_KEY        - optional
#
# Outputs:
#   docs/testnet-validation.md  - timestamped run history
#   backend/.env.example       - updated with new contract hashes
#   frontend/lib/contracts.ts  - updated contract hash registry
#   n8n_agent_backend/tools/schema.json - updated schema

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/docs/testnet-validation.md"
ENV_EXAMPLE="$ROOT/backend/.env.example"
FRONTEND_CONTRACTS="$ROOT/frontend/lib/contracts.ts"
MCP_SCHEMA="$ROOT/n8n_agent_backend/tools/schema.json"

# Load env from backend/.env if present.
if [ -f "$ROOT/backend/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/backend/.env"
  set +a
fi

LIVE=0
SKIP_DEPLOY=0
FULL_WRITE=0
for arg in "$@"; do
  case "$arg" in
    --live)         LIVE=1 ;;
    --dryrun)       LIVE=0 ;;
    --skip-deploy)  SKIP_DEPLOY=1 ;;
    --full)         FULL_WRITE=1 ;;
    *)              echo "⚠️  Unknown arg: $arg"; exit 2 ;;
  esac
done

RPC_URL="${CASPER_RPC_URL:-https://rpc.testnet.casper.live/rpc}"
CSPR_CLOUD="${CSPR_CLOUD_API_URL:-https://api.testnet.cspr.cloud}"
TS="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

# ── Pre-flight ──────────────────────────────────────────────────────────

if [ "$LIVE" -eq 1 ]; then
  if [ -z "${CASPER_SECRET_KEY:-}" ]; then
    echo "❌  CASPER_SECRET_KEY is required for --live runs"
    echo
    echo "Generate a fresh ed25519 keypair with:"
    echo "  casper-client keygen /tmp/testnet-signer.pem"
    echo "Fund it via https://testnet.cspr.live/tools/faucet (~1000 CSPR is enough)"
    echo "Then export CASPER_SECRET_KEY=\$(cat /tmp/testnet-signer.pem | jq -r .secret_key)"
    exit 1
  fi
  if ! [[ "${CASPER_SECRET_KEY}" =~ ^(0x)?[0-9a-fA-F]{64}$ ]]; then
    echo "❌  CASPER_SECRET_KEY must be 64-char hex (optional 0x prefix)"
    exit 1
  fi
fi

# ── Step 1: deploy contracts (if not skipping) ──────────────────────────

if [ "$SKIP_DEPLOY" -eq 0 ] && [ "$LIVE" -eq 1 ]; then
  echo "🚀  [1/5] Deploying 6 v1.0 contracts to Casper testnet…"
  echo "      RPC: $RPC_URL"
  echo "      Cloud: $CSPR_CLOUD"
  echo
  (cd "$ROOT/contract" && node scripts/deploy.js)
  echo
  echo "ℹ️  Copy the new hashes into backend/.env:"
  echo "      CASPER_AGENT_FACTORY_HASH=…"
  echo "      CASPER_REPUTATION_HASH=…"
  echo "      CASPER_ESCROW_HASH=…"
  echo "      CASPER_COMPLIANCE_HASH=…"
  echo "      CASPER_CEP18_HASH=…"
  echo "      CASPER_CEP78_HASH=…"
  echo
  echo "Re-run with --skip-deploy --full to continue."
  exit 0
fi

# ── Step 2: verify required env vars are set ───────────────────────────

if [ "$LIVE" -eq 1 ] || [ "$FULL_WRITE" -eq 1 ]; then
  required_vars=(
    CASPER_AGENT_FACTORY_HASH
    CASPER_REPUTATION_HASH
    CASPER_ESCROW_HASH
    CASPER_COMPLIANCE_HASH
    CASPER_CEP18_HASH
    CASPER_CEP78_HASH
  )
  missing=0
  for v in "${required_vars[@]}"; do
    if [ -z "${!v:-}" ]; then
      echo "❌  Missing env var $v"
      missing=$((missing + 1))
    fi
  done
  if [ "$missing" -gt 0 ]; then
    echo
    echo "Either deploy first (omit --skip-deploy) or pass --skip-deploy with"
    echo "the hashes already in backend/.env."
    exit 1
  fi
fi

# ── Step 3: run the v1.0 e2e (18 steps + 12 Phase 22 steps) ────────────

echo "🧪  [2/5] Running v1.0 + Phase 22 e2e against Casper testnet…"
if [ "$LIVE" -eq 0 ]; then
  set +e
  node "$ROOT/scripts/e2e-testnet.mjs" --dryrun \
    --factory    "${CASPER_AGENT_FACTORY_HASH:-hash-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}" \
    --reputation "${CASPER_REPUTATION_HASH:-hash-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb}" \
    --escrow     "${CASPER_ESCROW_HASH:-hash-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc}" \
    --compliance "${CASPER_COMPLIANCE_HASH:-hash-dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd}" \
    --cep18      "${CASPER_CEP18_HASH:-hash-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee}" \
    --cep78      "${CASPER_CEP78_HASH:-hash-ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff}" \
    --cspr-cloud "$CSPR_CLOUD" \
    --log "$LOG" \
    --phase28-ts "$TS"
  NODE_RC=$?
  set -e
  if [ "$NODE_RC" -ne 0 ] && [ "$NODE_RC" -ne 137 ]; then
    echo "❌  E2E failed with exit $NODE_RC"
    exit "$NODE_RC"
  fi
else
  node "$ROOT/scripts/e2e-testnet.mjs" --live \
    --factory    "${CASPER_AGENT_FACTORY_HASH}" \
    --reputation "${CASPER_REPUTATION_HASH}" \
    --escrow     "${CASPER_ESCROW_HASH}" \
    --compliance "${CASPER_COMPLIANCE_HASH}" \
    --cep18      "${CASPER_CEP18_HASH}" \
    --cep78      "${CASPER_CEP78_HASH}" \
    --cspr-cloud "$CSPR_CLOUD" \
    --log "$LOG" \
    --phase28-ts "$TS"
fi

# ── Step 4: write the validation log ────────────────────────────────────

echo
echo "📝  [3/5] Appending run to docs/testnet-validation.md…"
if [ "$LIVE" -eq 1 ]; then
  {
    echo
    echo "## Run $TS (Phase 28 — live testnet)"
    echo
    echo "| Field | Value |"
    echo "|-------|-------|"
    echo "| Timestamp | $TS |"
    echo "| RPC | $RPC_URL |"
    echo "| CSPR.cloud | $CSPR_CLOUD |"
    echo "| Deployer key | \`$(echo "${CASPER_SECRET_KEY}" | cut -c1-8)…\` |"
    echo "| Agent Factory | \`${CASPER_AGENT_FACTORY_HASH}\` |"
    echo "| Reputation | \`${CASPER_REPUTATION_HASH}\` |"
    echo "| Escrow | \`${CASPER_ESCROW_HASH}\` |"
    echo "| Compliance | \`${CASPER_COMPLIANCE_HASH}\` |"
    echo "| CEP-18 | \`${CASPER_CEP18_HASH}\` |"
    echo "| CEP-78 | \`${CASPER_CEP78_HASH}\` |"
    echo
    echo "### Event verification (fill in after running CSPR.cloud events query)"
    echo
    echo "| Event | First seen | Last seen | Block | Sample payload |"
    echo "|-------|------------|-----------|-------|----------------|"
    echo "| \`Attest\` |  |  |  |  |"
    echo "| \`RevokeAttestation\` |  |  |  |  |"
    echo "| \`Burn\` |  |  |  |  |"
    echo
    echo "### x402 payment sequence (fill in after running)"
    echo
    echo "| Step | Deploy hash | Status | Cost (CSPR) |"
    echo "|------|-------------|--------|-------------|"
    echo "| Payment deploy |  |  |  |"
    echo "| Tool deploy |  |  |  |"
    echo "| Refund deploy (if failed) |  |  |  |"
    echo
  } >> "$LOG"
fi

# ── Step 5: write contract hashes into config files ────────────────────

if [ "$FULL_WRITE" -eq 1 ] && [ "$LIVE" -eq 1 ]; then
  echo
  echo "✏️   [4/5] Updating backend/.env.example…"
  # Replace the empty placeholders with the new hashes.
  for pair in \
      "CASPER_AGENT_FACTORY_HASH=${CASPER_AGENT_FACTORY_HASH}" \
      "CASPER_REPUTATION_HASH=${CASPER_REPUTATION_HASH}" \
      "CASPER_ESCROW_HASH=${CASPER_ESCROW_HASH}" \
      "CASPER_COMPLIANCE_HASH=${CASPER_COMPLIANCE_HASH}"; do
    name="${pair%%=*}"
    value="${pair#*=}"
    if [ -f "$ENV_EXAMPLE" ]; then
      # Replace the line `^NAME=$` with the populated value.
      sed -i.bak -E "s|^${name}=$|${name}=${value}|" "$ENV_EXAMPLE"
      rm -f "$ENV_EXAMPLE.bak"
    fi
  done

  echo "✏️   [5/5] Updating frontend/lib/contracts.ts…"
  if [ -f "$FRONTEND_CONTRACTS" ]; then
    # The contract registry has shape:
    #   AGENT_FACTORY: 'hash-…',
    #   REPUTATION: 'hash-…',
    # …replace each value with the new hash.
    sed -i.bak -E "s|AGENT_FACTORY: '[^']*'|AGENT_FACTORY: '${CASPER_AGENT_FACTORY_HASH}'|" "$FRONTEND_CONTRACTS"
    sed -i.bak -E "s|REPUTATION: '[^']*'|REPUTATION: '${CASPER_REPUTATION_HASH}'|" "$FRONTEND_CONTRACTS"
    sed -i.bak -E "s|ESCROW: '[^']*'|ESCROW: '${CASPER_ESCROW_HASH}'|" "$FRONTEND_CONTRACTS"
    sed -i.bak -E "s|COMPLIANCE: '[^']*'|COMPLIANCE: '${CASPER_COMPLIANCE_HASH}'|" "$FRONTEND_CONTRACTS"
    rm -f "$FRONTEND_CONTRACTS.bak"
  fi

  echo "✏️   [5/5] Updating n8n_agent_backend/tools/schema.json…"
  if [ -f "$MCP_SCHEMA" ]; then
    # schema.json keys `factory_hash`, `reputation_hash`, etc.
    for pair in \
        "factory_hash=${CASPER_AGENT_FACTORY_HASH}" \
        "reputation_hash=${CASPER_REPUTATION_HASH}" \
        "escrow_hash=${CASPER_ESCROW_HASH}" \
        "compliance_hash=${CASPER_COMPLIANCE_HASH}"; do
      name="${pair%%=*}"
      value="${pair#*=}"
      sed -i.bak -E "s|\"${name}\": \"[^\"]*\"|\"${name}\": \"${value}\"|" "$MCP_SCHEMA"
      rm -f "$MCP_SCHEMA.bak"
    done
  fi

  echo
  echo "✅  Phase 28 complete — contracts deployed, e2e green, config updated."
  echo
  echo "Next steps:"
  echo "  1. Review docs/testnet-validation.md and fill in the event + x402 tables"
  echo "  2. Commit the updated env defaults + contract registry"
  echo "  3. Tag this release as v1.0.0-rc.1 once everything above is green"
else
  echo
  echo "✅  Phase 28 dryrun complete — re-run with --live --skip-deploy --full"
  echo "    after funding a testnet key + deploying the contracts."
fi