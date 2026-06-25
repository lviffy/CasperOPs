#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
AI_WORKFLOW_DIR="$ROOT_DIR/AI_workflow_backend"
N8N_AGENT_DIR="$ROOT_DIR/n8n_agent_backend"
PID_DIR="$ROOT_DIR/.pids"
BACKEND_PORT=3000
FRONTEND_PORT=3001

compose_cmd() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  else
    docker-compose "$@"
  fi
}

kill_matching_processes() {
  local pattern="$1"
  local label="$2"
  local pids

  pids="$(pgrep -f "$pattern" || true)"
  if [[ -n "$pids" ]]; then
    echo "⚠️  Cleaning stale $label process(es): $pids"
    kill $pids 2>/dev/null || true
  fi
}

stop_pid_file() {
  local file="$1"
  local label="$2"

  if [[ -f "$file" ]]; then
    local pid
    pid="$(cat "$file")"
    if kill -0 "$pid" 2>/dev/null; then
      echo "📦 Stopping $label (PID: $pid)..."
      kill "$pid" 2>/dev/null || true
    else
      echo "ℹ️  $label PID file found, but process is already stopped"
    fi
    rm -f "$file"
  else
    echo "ℹ️  No $label PID file found"
  fi
}

kill_port_if_busy() {
  local port="$1"
  local label="$2"
  local pids

  pids="$(fuser "$port"/tcp 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    echo "⚠️  Releasing port $port from $label process(es): $pids"
    kill $pids 2>/dev/null || true
  fi
}

echo "🛑 Stopping BlockOps services from $ROOT_DIR..."

echo "🐳 Stopping AI_workflow_backend..."
(
  cd "$AI_WORKFLOW_DIR"
  compose_cmd down
)
echo "✅ AI_workflow_backend stopped"

echo "🐳 Stopping n8n_agent_backend..."
(
  cd "$N8N_AGENT_DIR"
  compose_cmd down
)
echo "✅ n8n_agent_backend stopped"

stop_pid_file "$PID_DIR/backend.pid" "backend"
stop_pid_file "$PID_DIR/frontend.pid" "frontend"

kill_matching_processes "next dev --port $FRONTEND_PORT" "frontend"
kill_matching_processes "npm run dev --port $FRONTEND_PORT" "frontend"
kill_matching_processes "npm run dev -- --port $FRONTEND_PORT" "frontend"

kill_port_if_busy "$BACKEND_PORT" "backend"
kill_port_if_busy "$FRONTEND_PORT" "frontend"

echo ""
echo "✨ All services stopped successfully!"
