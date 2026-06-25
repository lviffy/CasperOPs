#!/usr/bin/env bash
# BlockOps backend deploy wrapper (Fly.io).
#
# Usage:
#   ./scripts/deploy-backend.sh           # deploy to production (Fly.io)
#   ./scripts/deploy-backend.sh staging    # deploy to a staging app
#   ./scripts/deploy-backend.sh logs       # tail production logs
#
# Reads fly.toml from backend/ unless --config is passed.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-prod}"

if ! command -v flyctl >/dev/null 2>&1; then
  echo "✗ flyctl not installed. Install: https://fly.io/docs/hands-on/install-flyctl/" >&2
  exit 1
fi

cd "$ROOT/backend"

case "$TARGET" in
  prod)
    APP_NAME="${FLY_APP_NAME:-blockops-backend}"
    flyctl deploy \
      --config backend/fly.toml \
      --dockerfile backend/Dockerfile \
      --strategy bluegreen \
      --wait-timeout 300
    echo "✓ Backend deployed. Smoke check:"
    flyctl status --app "$APP_NAME" | grep -E "(version|current)"
    URL="https://${APP_NAME}.fly.dev"
    curl -fsS "$URL/health/ready" | head -1 || echo "(health probe failed; investigate with flyctl logs)"
    ;;
  staging)
    APP_NAME="${FLY_STAGING_APP_NAME:-blockops-backend-staging}"
    FLY_APP_NAME="$APP_NAME" flyctl deploy \
      --config backend/fly.toml \
      --dockerfile backend/Dockerfile \
      --strategy rolling
    echo "✓ Staging deployed: https://${APP_NAME}.fly.dev"
    ;;
  logs)
    APP_NAME="${FLY_APP_NAME:-blockops-backend}"
    flyctl logs --app "$APP_NAME"
    ;;
  *)
    echo "Usage: $0 {prod|staging|logs}" >&2
    exit 1
    ;;
esac