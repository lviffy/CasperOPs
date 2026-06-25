#!/usr/bin/env bash
# CasperOPs frontend deploy wrapper (Vercel).
#
# Usage:
#   ./scripts/deploy-frontend.sh           # production deploy
#   ./scripts/deploy-frontend.sh preview    # preview deploy (PR-style URL)
#   ./scripts/deploy-frontend.sh logs       # tail Vercel logs
#
# The Vercel project root is `frontend/`. Env vars live in the Vercel
# dashboard (Settings → Environment Variables).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-prod}"

if ! command -v vercel >/dev/null 2>&1; then
  echo "✗ vercel CLI not installed. Install: npm i -g vercel" >&2
  exit 1
fi

cd "$ROOT/frontend"

case "$TARGET" in
  prod)
    vercel deploy --prod --yes
    echo "✓ Frontend deployed."
    ;;
  preview)
    vercel deploy --yes
    ;;
  logs)
    vercel logs
    ;;
  *)
    echo "Usage: $0 {prod|preview|logs}" >&2
    exit 1
    ;;
esac