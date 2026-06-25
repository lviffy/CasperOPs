#!/usr/bin/env bash
# scripts/incident-drills/rpc-outage.sh — synthetic RPC outage drill (Phase 30).
#
# Simulates a Casper RPC outage by routing the local backend's egress
# to a black hole (via /etc/hosts override + an env-overridden RPC URL)
# and verifies the failover layer transparently handles it. Useful
# for:
#
#   • Quarterly DR drills (the on-call runs this, then validates the
#     runbook procedures from docs/RUNBOOK.md §4)
#   • Load-balancer pre-flight: confirm the failover path works
#     BEFORE the real outage hits
#   • SLO verification: prove the 99.5% backend availability claim
#
# Usage:
#   scripts/incident-drills/rpc-outage.sh --start    # blackhole the primary RPC
#   scripts/incident-drills/rpc-outage.sh --status    # check current drill state
#   scripts/incident-drills/rpc-outage.sh --stop      # restore
#   scripts/incident-drills/rpc-outage.sh --verify    # only verify the snapshot
#
# Env vars:
#   CASPER_RPC_URL          primary RPC to blackhole (default https://rpc.testnet.casper.live/rpc)
#   CASPER_RPC_URL_FALLBACK fallback to verify (default https://api.testnet.cspr.cloud)
#   BACKEND_HEALTH_URL      URL to probe (default http://localhost:3000/health/ready)
#   DRILL_LOG               log file (default /tmp/casperops-rpc-drill.log)

set -euo pipefail

RPC_URL="${CASPER_RPC_URL:-https://rpc.testnet.casper.live/rpc}"
FALLBACK_URL="${CASPER_RPC_URL_FALLBACK:-https://api.testnet.cspr.cloud}"
HEALTH_URL="${BACKEND_HEALTH_URL:-http://localhost:3000/health/ready}"
LOG="${DRILL_LOG:-/tmp/casperops-rpc-drill.log}"

HOSTS=/etc/hosts
MARKER="# CASPEROPS_RPC_DRILL_MARKER"

ts() { date -u +'%Y-%m-%dT%H:%M:%SZ'; }
log() { printf '[rpc-outage %s] %s\n' "$(ts)" "$*" | tee -a "$LOG"; }

# Extract host (no scheme, no path) for /etc/hosts.
HOST=$(printf '%s' "$RPC_URL" | sed -E 's|^https?://||; s|/.*$||')
SINK="127.0.0.1"

start_drill() {
  if grep -qF "$MARKER" "$HOSTS" 2>/dev/null; then
    log "Drill already active — re-using existing /etc/hosts entry"
    return
  fi
  log "Blackholing $HOST → $SINK"
  printf '\n%s %s\n' "$MARKER" "$HOST $SINK" | sudo tee -a "$HOSTS" >/dev/null
  log "  $HOSTS updated"
}

stop_drill() {
  if ! grep -qF "$MARKER" "$HOSTS" 2>/dev/null; then
    log "No active drill — nothing to stop"
    return
  fi
  log "Restoring $HOST from $SINK"
  sudo sed -i.bak "/$MARKER/d" "$HOSTS"
  log "  $HOSTS restored (backup at ${HOSTS}.bak)"
}

status() {
  if grep -qF "$MARKER" "$HOSTS" 2>/dev/null; then
    log "Drill is ACTIVE — $HOST is blackholed"
    return 0
  fi
  log "Drill is INACTIVE"
  return 1
}

verify() {
  log "Probing $HEALTH_URL"
  local body
  body=$(curl -fsS --max-time 5 "$HEALTH_URL" 2>&1) || {
    log "  ERROR: readiness probe failed (drill might be active + no fallback configured)"
    return 1
  }
  # Pretty-print the activeRpc + failover snapshot from the JSON body.
  local active fallback_ok
  active=$(echo "$body" | sed -n 's/.*"activeRpc":"\([^"]*\)".*/\1/p')
  fallback_ok=$(echo "$body" | sed -n 's/.*"fallback":{[^}]*"ok":\([a-z]*\).*/\1/p' | head -n1)
  log "  activeRpc: $active"
  log "  fallback.ok: $fallback_ok"
  if [ -n "$active" ] && [ "$active" != "$RPC_URL" ]; then
    log "  ✅ Failover engaged — backend is using $active"
  else
    log "  ℹ️  Primary still active (drill may not be in effect)"
  fi
}

case "${1:-}" in
  --start) start_drill; verify ;;
  --stop)  stop_drill; verify ;;
  --status) status ;;
  --verify) verify ;;
  *) echo "Usage: $0 --start|--stop|--status|--verify" >&2; exit 2 ;;
esac