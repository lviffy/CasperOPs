#!/usr/bin/env bash
# Phase 22 e2e helper: deploys the v1.0 contracts to Casper testnet and runs
# the v1.0 hardening checks (`set_paused`, `transfer_ownership`, burn,
# compliance events) against the live RPC.
#
# Usage:
#   ./scripts/e2e-testnet-phase22.sh                # dryrun, no live RPC
#   ./scripts/e2e-testnet-phase22.sh --live         # full live testnet run
#   ./scripts/e2e-testnet-phase22.sh --skip-deploy  # use existing hashes
#
# Required env vars (live mode):
#   CASPER_RPC_URL          - default https://rpc.testnet.casper.live/rpc
#   CASPER_CLOUD_API_URL    - default https://api.testnet.cspr.cloud
#   CASPER_SECRET_KEY       - 64-char hex testnet key
#   CASPER_AGENT_FACTORY_HASH (after deploy.js)
#   CASPER_REPUTATION_HASH
#   CASPER_ESCROW_HASH
#   CASPER_COMPLIANCE_HASH
#   CASPER_CEP18_HASH
#   CASPER_CEP78_HASH
#
# Output is appended to docs/testnet-validation.md.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/docs/testnet-validation.md"

# Load env from backend/.env if present.
if [ -f "$ROOT/backend/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/backend/.env"
  set +a
fi

RPC_URL="${CASPER_RPC_URL:-https://rpc.testnet.casper.live/rpc}"
CSPR_CLOUD="${CASPER_CLOUD_API_URL:-https://api.testnet.cspr.cloud}"
SKIP_DEPLOY=0
LIVE=0
for arg in "$@"; do
  case "$arg" in
    --skip-deploy) SKIP_DEPLOY=1 ;;
    --live)        LIVE=1 ;;
    --dryrun)      LIVE=0 ;;
  esac
done

if [ "$LIVE" -eq 0 ]; then
  echo "🧪  Running Phase 22 e2e in DRYRUN mode (in-memory mock, no live RPC)"
  echo
  # The node script self-terminates with SIGKILL to drop lingering casper-js-sdk
  # handles; disable `set -e` around it so a 137 exit doesn't fail the script.
  set +e
  node "$ROOT/scripts/e2e-testnet.mjs" --dryrun \
    --factory    "${CASPER_AGENT_FACTORY_HASH:-hash-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}" \
    --reputation "${CASPER_REPUTATION_HASH:-hash-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb}" \
    --escrow     "${CASPER_ESCROW_HASH:-hash-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc}" \
    --compliance "${CASPER_COMPLIANCE_HASH:-hash-dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd}" \
    --cep18      "${CASPER_CEP18_HASH:-hash-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee}" \
    --cep78      "${CASPER_CEP78_HASH:-hash-ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff}" \
    --cspr-cloud "$CSPR_CLOUD" \
    --log "$LOG"
  NODE_RC=$?
  set -e
  if [ "$NODE_RC" -ne 0 ] && [ "$NODE_RC" -ne 137 ]; then
    echo "❌  Phase 22 dryrun failed with exit $NODE_RC"
    exit "$NODE_RC"
  fi
  echo
  echo "✅  Dryrun complete. Re-run with --live once the contracts are deployed and funded."
  exit 0
fi

# Live path
required_vars=(
  CASPER_SECRET_KEY
  CASPER_AGENT_FACTORY_HASH
  CASPER_REPUTATION_HASH
  CASPER_ESCROW_HASH
  CASPER_COMPLIANCE_HASH
  CASPER_CEP18_HASH
  CASPER_CEP78_HASH
)
for v in "${required_vars[@]}"; do
  if [ -z "${!v:-}" ]; then
    echo "❌  Missing env var $v"
    echo "    Run: cd contract && node scripts/deploy.js first,"
    echo "    then re-run with --skip-deploy after copying the contract hashes"
    exit 1
  fi
done

if [ "$SKIP_DEPLOY" -eq 0 ]; then
  echo "🚀  Deploying v1.0 Odra contracts to Casper testnet…"
  (cd "$ROOT/contract" && node scripts/deploy.js)
  echo
  echo "ℹ️  Copy the new contract hashes into backend/.env and re-run with --skip-deploy"
  exit 0
fi

echo "🧪  Running Phase 22 e2e against testnet RPC: $RPC_URL"
echo

set +e
node "$ROOT/scripts/e2e-testnet.mjs" \
  --rpc         "$RPC_URL" \
  --cspr-cloud  "$CSPR_CLOUD" \
  --factory     "$CASPER_AGENT_FACTORY_HASH" \
  --reputation  "$CASPER_REPUTATION_HASH" \
  --escrow      "$CASPER_ESCROW_HASH" \
  --compliance  "$CASPER_COMPLIANCE_HASH" \
  --cep18       "$CASPER_CEP18_HASH" \
  --cep78       "$CASPER_CEP78_HASH" \
  --secret-key  "$CASPER_SECRET_KEY" \
  --log "$LOG"
NODE_RC=$?
set -e

echo
if [ "$NODE_RC" -ne 0 ] && [ "$NODE_RC" -ne 137 ]; then
  echo "❌  Phase 22 e2e failed with exit $NODE_RC"
  exit "$NODE_RC"
fi
echo "✅  Phase 22 e2e run complete. See $LOG for the full audit trail."
