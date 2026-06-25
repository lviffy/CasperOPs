#!/usr/bin/env bash
# End-to-end Casper testnet validation for CasperOPs.
#
# Runs the canonical agent flow against the live Casper testnet:
#   1. register_agent
#   2. attest_agent
#   3. get_reputation
#   4. escrow_deposit
#   5. escrow_payout
#   6. final state check via CSPR.cloud
#
# Required env vars (sourced from backend/.env):
#   CASPER_RPC_URL          - default https://rpc.testnet.casper.live/rpc
#   CASPER_CLOUD_API_URL    - default https://api.testnet.cspr.cloud
#   CASPER_SECRET_KEY       - hex (ed25519 or secp256k1) testnet secret key
#   CASPER_AGENT_FACTORY_HASH
#   CASPER_REPUTATION_HASH
#   CASPER_ESCROW_HASH
#   CASPER_COMPLIANCE_HASH
#
# Usage:
#   ./scripts/e2e-testnet.sh                # runs all steps
#   ./scripts/e2e-testnet.sh --skip-deploy  # assumes contracts already deployed
#
# Output is appended to docs/testnet-validation.md so the run becomes a
# reproducible audit trail.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/docs/testnet-validation.md"
DEPLOY_LOG="$(mktemp)"

# Load env from backend/.env
if [ -f "$ROOT/backend/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/backend/.env"
  set +a
fi

RPC_URL="${CASPER_RPC_URL:-https://rpc.testnet.casper.live/rpc}"
CSPR_CLOUD="${CASPER_CLOUD_API_URL:-https://api.testnet.cspr.cloud}"
SKIP_DEPLOY=0
for arg in "$@"; do
  case "$arg" in
    --skip-deploy) SKIP_DEPLOY=1 ;;
  esac
done

required_vars=(
  CASPER_SECRET_KEY
  CASPER_AGENT_FACTORY_HASH
  CASPER_REPUTATION_HASH
  CASPER_ESCROW_HASH
  CASPER_COMPLIANCE_HASH
)
for v in "${required_vars[@]}"; do
  if [ -z "${!v:-}" ]; then
    echo "❌  Missing env var $v"
    exit 1
  fi
done

if [ "$SKIP_DEPLOY" -eq 0 ]; then
  echo "🚀  Deploying Odra contracts to Casper testnet…"
  (cd "$ROOT/contract" && node scripts/deploy.js) | tee "$DEPLOY_LOG"
  echo
  echo "ℹ️  After deploy, copy the new contract hashes into backend/.env and re-run with --skip-deploy"
fi

echo "🧪  Running end-to-end agent flow against testnet RPC: $RPC_URL"
echo

node "$ROOT/scripts/e2e-testnet.mjs" \
  --rpc "$RPC_URL" \
  --cspr-cloud "$CSPR_CLOUD" \
  --factory "$CASPER_AGENT_FACTORY_HASH" \
  --reputation "$CASPER_REPUTATION_HASH" \
  --escrow "$CASPER_ESCROW_HASH" \
  --compliance "$CASPER_COMPLIANCE_HASH" \
  --secret-key "$CASPER_SECRET_KEY" \
  --log "$LOG"

echo
echo "✅  End-to-end testnet run complete. See $LOG for full deploy + execution log."
