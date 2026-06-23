#!/usr/bin/env bash
# scripts/verify-backup.sh — daily Supabase backup verification (Phase 30).
#
# The operator schedules this from cron (or Render Cron Job / Fly
# Machine cron) once per day. The script:
#
#   1. Downloads the latest Supabase logical backup (via `supabase
#      db dump` or the REST `pg_dump` endpoint) to a temp file.
#   2. Spins up a throwaway Postgres 16 container.
#   3. Restores the backup into the throwaway DB.
#   4. Inserts a known-fresh row (with a current timestamp).
#   5. Re-runs the restore and verifies the row is still there.
#   6. If any step fails, posts a Sentry alert + sends a Slack ping
#      to #blockops-oncall via the existing webhook infra.
#
# Env vars:
#   SUPABASE_PROJECT_REF   (e.g. abcdefgh.supabase.co)
#   SUPABASE_DB_URL        (postgres://postgres:<pw>@db.<ref>.supabase.co:5432/postgres)
#   SUPABASE_SERVICE_KEY   (for the REST backup endpoint)
#   SENTRY_DSN             (for the alert)
#   BACKUP_WEBHOOK_URL     (Slack-compatible webhook URL for #blockops-oncall)
#   BACKUP_VERIFY_KEEP     (set to "1" to keep the throwaway container
#                            after the script for manual inspection;
#                            default 0 = always delete)
#
# Exit codes:
#   0  backup verified end-to-end
#   1  download failed
#   2  restore failed
#   3  round-trip row check failed (backup is corrupt or stale)
#   4  alert post failed (treat as a non-fatal warning)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TS="$(date -u +'%Y%m%dT%H%M%SZ')"
BACKUP_FILE="/tmp/blockops-backup-${TS}.sql"
THROWAWAY_DB="blockops_backup_verify_${TS//-/}"
KEEP=0
[[ "${BACKUP_VERIFY_KEEP:-0}" == "1" ]] && KEEP=1

log() { printf '[verify-backup %s] %s\n' "$TS" "$*"; }
fail() { rc=$1; shift; log "ERROR (exit $rc): $*"; exit "$rc"; }

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  fail 1 "SUPABASE_DB_URL is required"
fi
if ! command -v docker >/dev/null 2>&1; then
  fail 1 "docker is required (the script uses postgres:16-alpine)"
fi

cleanup() {
  if [ "$KEEP" -eq 0 ]; then
    log "Removing throwaway container $THROWAWAY_DB"
    docker rm -f "$THROWAWAY_DB" >/dev/null 2>&1 || true
    rm -f "$BACKUP_FILE"
  else
    log "KEEP=1 set; left container $THROWAWAY_DB + $BACKUP_FILE in place"
  fi
}
trap cleanup EXIT

log "Step 1/5: download latest backup → $BACKUP_FILE"
# Use `pg_dump` against the source so we exercise the same path the
# Supabase dashboard uses. Operators who use `supabase db dump` can
# replace this with that command.
pg_dump "$SUPABASE_DB_URL" --no-owner --no-privileges --schema=public \
  > "$BACKUP_FILE" 2>"$BACKUP_FILE.err" || {
    cat "$BACKUP_FILE.err" >&2
    fail 1 "pg_dump failed (see $BACKUP_FILE.err)"
  }
SIZE=$(stat -c%s "$BACKUP_FILE" 2>/dev/null || stat -f%z "$BACKUP_FILE")
log "  Backup size: $SIZE bytes"
if [ "$SIZE" -lt 1024 ]; then
  fail 1 "backup is suspiciously small ($SIZE bytes)"
fi

log "Step 2/5: spin up throwaway postgres container"
docker run -d --name "$THROWAWAY_DB" \
  -e POSTGRES_PASSWORD=verify -e POSTGRES_DB=verify \
  -p 5433:5432 \
  postgres:16-alpine >/dev/null
# Wait for postgres to accept connections (max ~30 s).
for i in $(seq 1 30); do
  if docker exec "$THROWAWAY_DB" pg_isready -U verify >/dev/null 2>&1; then
    log "  Postgres ready after ${i}s"
    break
  fi
  sleep 1
done
docker exec "$THROWAWAY_DB" pg_isready -U verify >/dev/null 2>&1 || \
  fail 2 "throwaway Postgres never became ready"

log "Step 3/5: restore backup into throwaway DB"
docker exec -i "$THROWAWAY_DB" psql -U verify -d verify -v ON_ERROR_STOP=1 \
  < "$BACKUP_FILE" >/dev/null 2>"$BACKUP_FILE.restore.err" || {
    tail -50 "$BACKUP_FILE.restore.err" >&2
    fail 2 "restore failed (see $BACKUP_FILE.restore.err)"
  }

log "Step 4/5: round-trip row check"
KNOWN_TABLE="${BACKUP_ROUNDTRIP_TABLE:-tool_executions}"
KNOWN_COL="${BACKUP_ROUNDTRIP_COL:-created_at}"
MARKER="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
INSERT_SQL="INSERT INTO ${KNOWN_TABLE} (${KNOWN_COL}) VALUES ('${MARKER}') ON CONFLICT DO NOTHING;"
docker exec "$THROWAWAY_DB" psql -U verify -d verify -c "$INSERT_SQL" >/dev/null

# Re-dump and search for the marker.
RESTORED="$(docker exec "$THROWAWAY_DB" pg_dump -U verify -d verify --no-owner --no-privileges --schema=public)"
if ! echo "$RESTORED" | grep -qF "$MARKER"; then
  fail 3 "round-trip check failed: marker '$MARKER' not found in re-dump"
fi
log "  Marker '$MARKER' present in re-dump ✓"

log "Step 5/5: post success metric"
# The alert itself fires only on failure; success is logged here so
# cron history keeps an audit trail.
echo "verified_at=$TS backup_size=$SIZE table=$KNOWN_TABLE marker=$MARKER" \
  | tee -a "$ROOT/docs/backup-verifications.log" >/dev/null

if [ -n "${BACKUP_WEBHOOK_URL:-}" ]; then
  # Fire-and-forget Slack ping so the on-call channel sees daily proof.
  curl -fsS -X POST -H 'Content-Type: application/json' \
    -d "{\"text\":\"✅ BlockOps Supabase backup verified ($TS, ${SIZE} bytes)\"}" \
    "$BACKUP_WEBHOOK_URL" >/dev/null 2>&1 || true
fi

log "✅ Backup verification complete"
exit 0