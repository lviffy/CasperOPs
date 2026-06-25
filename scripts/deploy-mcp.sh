#!/usr/bin/env bash
# CasperOPs MCP deploy wrapper (Render).
#
# Usage:
#   ./scripts/deploy-mcp.sh           # trigger deploy via Render API
#   ./scripts/deploy-mcp.sh logs      # tail MCP logs
#
# Requires RENDER_API_KEY + RENDER_SERVICE_ID env vars. The service is
# configured in the Render dashboard to deploy from the `n8n_agent_backend/`
# directory using its Dockerfile.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-deploy}"

: "${RENDER_API_KEY:?RENDER_API_KEY not set}"
: "${RENDER_SERVICE_ID:?RENDER_SERVICE_ID not set}"

case "$TARGET" in
  deploy)
    echo "→ triggering Render deploy for service $RENDER_SERVICE_ID"
    curl -fsS -X POST \
      -H "Authorization: Bearer $RENDER_API_KEY" \
      -H "Content-Type: application/json" \
      "https://api.render.com/v1/services/$RENDER_SERVICE_ID/deploys" \
      -d '{}' | jq '.id // .' | head -1
    echo "✓ Deploy triggered. Tail: ./scripts/deploy-mcp.sh logs"
    ;;
  logs)
    # Render doesn't expose log streaming via the public API without a
    # paid plan; in practice we tail the logs from the dashboard.
    echo "→ open https://dashboard.render.com/web/$RENDER_SERVICE_ID/logs"
    ;;
  *)
    echo "Usage: $0 {deploy|logs}" >&2
    exit 1
    ;;
esac