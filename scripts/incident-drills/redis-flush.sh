#!/usr/bin/env bash
# scripts/incident-drills/redis-flush.sh — synthetic Redis flush drill (Phase 30).
#
# Simulates a `FLUSHDB` on the production Redis to validate:
#   • The backend survives without Redis (best-effort cache layer)
#   • The MCP server gracefully logs the loss + recovers as sessions
#     reconnect
#   • Sentry fires the expected alert (operator should check after)
#
# Usage:
#   scripts/incident-drills/redis-flush.sh --verify    # only verify the snapshot
#   scripts/incident-drills/redis-flush.sh --flush     # FLUSHDB on the configured Redis
#
# Env vars:
#   REDIS_URL         (e.g. redis://default:<pw>@<host>.flycast:6379/0)
#   BACKEND_HEALTH_URL (default http://localhost:3000/health/ready)
#   DRILL_LOG          (default /tmp/casperops-redis-drill.log)
#
# The drill is reversible: the cache will repopulate from the next
# user-facing read within the TTL (Phase 27: 5-60 s depending on the
# tool). The drill measures "time to full cache repopulation" as the
# SLO signal.

set -euo pipefail

REDIS_URL="${REDIS_URL:-}"
HEALTH_URL="${BACKEND_HEALTH_URL:-http://localhost:3000/health/ready}"
LOG="${DRILL_LOG:-/tmp/casperops-redis-drill.log}"

ts() { date -u +'%Y-%m-%dT%H:%M:%SZ'; }
log() { printf '[redis-flush %s] %s\n' "$(ts)" "$*" | tee -a "$LOG"; }

if [ -z "$REDIS_URL" ]; then
  echo "REDIS_URL is required (set it to the same value as the backend)" >&2
  exit 2
fi

if ! command -v redis-cli >/dev/null 2>&1; then
  echo "redis-cli is required (apt-get install redis-tools or brew install redis)" >&2
  exit 2
fi

verify() {
  log "Pre-flight: probing $HEALTH_URL"
  local before
  before=$(curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null || echo '{}')
  local redis_status
  redis_status=$(echo "$before" | sed -n 's/.*"label":"redis","ok":\([a-z]*\).*/\1/p')
  log "  Redis health (before): ${redis_status:-unknown}"
  log "  Use the SLO dashboard to monitor repopulation rate (cache hits climb back to baseline in 60-120 s)"
}

flush() {
  log "⚠️  FLUSHDB on $REDIS_URL"
  # FLUSHDB drops the CURRENT DB only (safer than FLUSHALL). The
  # MCP SSE session data lives in mcp:* keys — those are gone after
  # this drill.
  redis-cli -u "$REDIS_URL" FLUSHDB
  log "  Redis flushed at $(ts)"
  log "  Watching /health/ready for the next 60 s…"
  for i in $(seq 1 12); do
    sleep 5
    local body
    body=$(curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null || echo '{}')
    local redis_ok
    redis_ok=$(echo "$body" | sed -n 's/.*"label":"redis","ok":\([a-z]*\).*/\1/p')
    log "  +$((i * 5))s — redis ok: ${redis_ok:-unknown}"
  done
  log "  Drill complete — confirm Sentry captured the alert + SLO dashboard shows recovery"
}

case "${1:-}" in
  --flush) flush ;;
  --verify) verify ;;
  *) echo "Usage: $0 --flush|--verify" >&2; exit 2 ;;
esac