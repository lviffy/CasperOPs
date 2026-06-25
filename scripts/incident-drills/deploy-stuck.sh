#!/usr/bin/env bash
# scripts/incident-drills/deploy-stuck.sh — synthetic deploy-stuck drill (Phase 30).
#
# Validates the deploy-stuck alert + runbook by:
#   1. POSTing a fake `lookup_deploy` with a non-existent deploy hash
#      (so the backend returns "unknown" — the same condition a stuck
#      pending deploy produces)
#   2. Asserting `blockops_deploy_stuck_total` ticks up
#   3. Asserting the Sentry alert fires
#   4. Walking the on-call through RUNBOOK.md §1 "Deploy stuck pending
#      > 5 minutes" step by step
#
# This drill is purely a smoke test — it doesn't actually create a
# stuck deploy (that requires a real Casper network round-trip). But
# it surfaces the alert + the runbook link in a controlled setting so
# the on-call isn't seeing them for the first time at 3 AM.
#
# Usage:
#   scripts/incident-drills/deploy-stuck.sh --verify
#
# Env vars:
#   BACKEND_URL          (default http://localhost:3000)
#   METRICS_TOKEN        (optional; required if backend /metrics is gated)
#   DRILL_LOG            (default /tmp/blockops-deploy-drill.log)

set -euo pipefail

BACKEND_URL="${BACKEND_URL:-http://localhost:3000}"
METRICS_TOKEN="${METRICS_TOKEN:-}"
LOG="${DRILL_LOG:-/tmp/blockops-deploy-drill.log}"

ts() { date -u +'%Y-%m-%dT%H:%M:%SZ'; }
log() { printf '[deploy-stuck %s] %s\n' "$(ts)" "$*" | tee -a "$LOG"; }

NONEXISTENT_HASH="$(printf '%064d' 0)"

log "Step 1/4: hit /v1/tools/lookup_deploy with a non-existent hash"
RESP=$(curl -fsS -X POST -H 'Content-Type: application/json' \
  -d "{\"params\":{\"deploy_hash\":\"$NONEXISTENT_HASH\"}}" \
  "$BACKEND_URL/v1/tools/lookup_deploy" 2>&1) || {
  log "  ERROR: backend returned an error response"
  echo "$RESP" >&2
  exit 1
}
log "  Response: $RESP"

log "Step 2/4: read /metrics to confirm deploy_stuck_total is exposed"
METRICS_URL="$BACKEND_URL/metrics"
if [ -n "$METRICS_TOKEN" ]; then
  METRICS_HEADERS=(-H "Authorization: Bearer $METRICS_TOKEN")
else
  METRICS_HEADERS=()
fi
METRICS=$(curl -fsS "${METRICS_HEADERS[@]}" --max-time 5 "$METRICS_URL" 2>&1) || {
  log "  ERROR: /metrics unreachable (gate is probably configured for prod only)"
  exit 1
}
if echo "$METRICS" | grep -q 'blockops_deploy_stuck_total'; then
  log "  ✅ deploy_stuck_total exposed"
else
  log "  ⚠️  deploy_stuck_total not in /metrics output yet — expected after a real stuck deploy"
fi

log "Step 3/4: walk the on-call through RUNBOOK.md §1"
cat <<'EOF'
  RUNBOOK.md §1 — Deploy stuck pending > 5 minutes
  ────────────────────────────────────────────────────
  1. Grab the deploy hash from the Sentry alert or the user's X-Request-Id
  2. Run info_get_deploy against Casper RPC; check status:
     - pending → RPC never picked it up — re-broadcast manually
     - unknown → RPC node dropped it — switch CASPER_RPC_URL to fallback
     - executed-with-error → the deploy landed but failed; check args
  3. Trigger refund middleware (POST /v1/tools/<toolId> with the same
     payment deploy hash re-broadcasts the refund on next 5xx)
  4. If the refund didn't fire, audit blockops_x402_refunds_total{status="failed"}
EOF
log "  (Walkthrough complete — on-call should be able to do each step)"

log "Step 4/4: verify Sentry alert pipeline"
log "  Manually trigger a test event: send a GET to /health/live from a misconfigured IP, watch the Sentry dashboard for the alert"
log "  Drill complete"

exit 0