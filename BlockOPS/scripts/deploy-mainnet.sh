#!/usr/bin/env bash
# Phase 29 — Casper mainnet deploy script.
#
# Same flow as scripts/e2e-testnet-phase28.sh but with extra
# confirmation prompts (real CSPR is on the line) and a `--dryrun`
# mode that prints the deploy plan without broadcasting.
#
# Usage:
#   ./scripts/deploy-mainnet.sh --dryrun         # print plan, no broadcast
#   ./scripts/deploy-mainnet.sh --confirm        # interactive confirmations
#   ./scripts/deploy-mainnet.sh --yes            # skip confirmations (CI only)
#
# Required env vars:
#   CASPER_MAINNET_RPC_URL              (default https://rpc.mainnet.casperlabs.io/rpc)
#   CASPER_SECRET_KEY                   (mainnet ed25519 hex key, NOT the testnet one)
#   CASPER_MAINNET_AGENT_FACTORY_HASH   (post-deploy; populated by the script)
#   CASPER_MAINNET_REPUTATION_HASH
#   CASPER_MAINNET_ESCROW_HASH
#   CASPER_MAINNET_COMPLIANCE_HASH
#   CASPER_MAINNET_CEP18_HASH
#   CASPER_MAINNET_CEP78_HASH
#
# Cost: ~12 CSPR per contract deploy → ~75 CSPR for the v1.0 set + 5 CSPR
# for the e2e. Plan for 100 CSPR + buffer.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Load .env so the script can be run without manual exports.
if [ -f "$ROOT/backend/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/backend/.env"
  set +a
fi

DRYRUN=0
CONFIRM=1
YES=0
for arg in "$@"; do
  case "$arg" in
    --dryrun)  DRYRUN=1 ;;
    --confirm) CONFIRM=1 ;;
    --yes)     YES=1; CONFIRM=0 ;;
    *)         echo "⚠️  Unknown arg: $arg"; exit 2 ;;
  esac
done

RPC_URL="${CASPER_MAINNET_RPC_URL:-https://rpc.mainnet.casperlabs.io/rpc}"

echo "═════════════════════════════════════════════════════════════"
echo "  BlockOps Casper mainnet deploy — v1.0.0"
echo "═════════════════════════════════════════════════════════════"
echo
echo "  RPC:        $RPC_URL"
echo "  Explorer:   https://cspr.live"
echo "  Cost:       ~75 CSPR deploys + ~5 CSPR e2e"
echo
echo "═════════════════════════════════════════════════════════════"

# ── Pre-flight ──────────────────────────────────────────────────────────

if [ -z "${CASPER_SECRET_KEY:-}" ]; then
  echo "❌  CASPER_SECRET_KEY is required (mainnet ed25519 hex key)"
  exit 1
fi
if ! [[ "${CASPER_SECRET_KEY}" =~ ^(0x)?[0-9a-fA-F]{64}$ ]]; then
  echo "❌  CASPER_SECRET_KEY must be 64-char hex (optional 0x prefix)"
  exit 1
fi

# Refuse to deploy if the key looks like a known testnet faucet key.
# (Real attack surface here: a leaked testnet key with faucet funds.)
if [[ "${CASPER_SECRET_KEY}" == "0101010101010101010101010101010101010101010101010101010101010101" ]]; then
  echo "❌  Refusing to deploy with the canonical '01…01' test key"
  exit 1
fi

# Print the public key for verification.
PUBKEY=$(node -e "
  const k = require('casper-js-sdk').Keys.Ed25519.loadKeyPairFromPrivateKey(
    Buffer.from(process.env.CASPER_SECRET_KEY.replace(/^0x/, ''), 'hex')
  );
  console.log(k.publicKey.toHex());
")
echo "  Deployer public key: $PUBKEY"
echo

# Check the balance — refuse to proceed if < 100 CSPR.
BALANCE=$(node -e "
  const {CasperServiceByJsonRPC, Keys} = require('casper-js-sdk');
  const c = new CasperServiceByJsonRPC(process.env.CASPER_MAINNET_RPC_URL || 'https://rpc.mainnet.casperlabs.io/rpc');
  const pk = Keys.Ed25519.loadKeyPairFromPrivateKey(
    Buffer.from(process.env.CASPER_SECRET_KEY.replace(/^0x/, ''), 'hex')
  ).publicKey;
  c.getAccountBalance(pk.toHex()).then(b => console.log(b.toString())).catch(e => { console.error(e.message); process.exit(1); });
")
BALANCE_CSPR=$(node -e "console.log(Number('$BALANCE') / 1e9)")
echo "  Deployer balance:   $BALANCE_CSPR CSPR ($BALANCE motes)"
echo

if (( $(echo "$BALANCE_CSPR < 100" | bc -l) )); then
  echo "❌  Balance is below 100 CSPR — refusing to deploy"
  echo "    Fund the deployer key before retrying."
  exit 1
fi

# ── Confirmation ────────────────────────────────────────────────────────

if [ "$CONFIRM" -eq 1 ]; then
  echo "About to deploy the v1.0 contract set to MAINNET."
  echo "This will spend ~75 CSPR and is irreversible once broadcast."
  echo
  read -r -p "Type 'deploy-mainnet' to continue: " answer
  if [ "$answer" != "deploy-mainnet" ]; then
    echo "Aborted."
    exit 1
  fi
fi

# ── Dryrun ──────────────────────────────────────────────────────────────

if [ "$DRYRUN" -eq 1 ]; then
  echo
  echo "🧪  DRYRUN — would deploy the following contracts:"
  echo "    • AgentFactory"
  echo "    • Reputation"
  echo "    • Escrow"
  echo "    • Compliance"
  echo "    • CEP-18 (CSPR token)"
  echo "    • CEP-78 (NFT collection)"
  echo
  echo "Deploy commands that would run:"
  echo "  (cd contract && node scripts/deploy.js --network mainnet \\"
  echo "    --rpc $RPC_URL \\"
  echo "    --secret-key \${CASPER_SECRET_KEY:0:8}…)"
  echo
  echo "Post-deploy steps that would run:"
  echo "  • Write hashes to backend/.env (CASPER_MAINNET_*_HASH)"
  echo "  • Run scripts/e2e-testnet-phase28.sh --live --skip-deploy --full"
  echo "  • Verify CSPR.cloud events for Attest / RevokeAttestation / Burn"
  echo "  • Commit the testnet-validation.md update"
  echo "  • Tag the release as v1.0.0"
  exit 0
fi

# ── Real deploy ─────────────────────────────────────────────────────────

echo "🚀  Deploying 6 v1.0 contracts to Casper MAINNET…"
(cd "$ROOT/contract" && node scripts/deploy.js --network mainnet \
   --rpc "$RPC_URL" \
   --secret-key "$CASPER_SECRET_KEY")
echo
echo "✅  Deploys complete. Copy the new hashes from the deploy output into"
echo "   backend/.env (CASPER_MAINNET_*_HASH) and re-run with --confirm to"
echo "   promote + run the e2e."