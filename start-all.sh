#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
AI_WORKFLOW_DIR="$ROOT_DIR/AI_workflow_backend"
N8N_AGENT_DIR="$ROOT_DIR/n8n_agent_backend"
PID_DIR="$ROOT_DIR/.pids"
LOG_DIR="$ROOT_DIR/.logs"
BACKEND_PORT=3000
FRONTEND_PORT=3001

mkdir -p "$PID_DIR" "$LOG_DIR"

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
    sleep 1
  fi
}

kill_port_if_busy() {
  local port="$1"
  local label="$2"
  local pids

  pids="$(fuser "$port"/tcp 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    echo "⚠️  Releasing port $port from existing $label process(es): $pids"
    kill $pids 2>/dev/null || true
    sleep 1
  fi
}

cleanup_pid_file() {
  local file="$1"

  if [[ -f "$file" ]]; then
    local pid
    pid="$(cat "$file")"
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
    rm -f "$file"
  fi
}

wait_for_port() {
  local port="$1"
  local timeout="$2"

  for ((i = 0; i < timeout; i++)); do
    if fuser "$port"/tcp >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  return 1
}

echo "🚀 Starting BlockOps services from $ROOT_DIR..."

kill_matching_processes "next dev --port $FRONTEND_PORT" "frontend"
kill_matching_processes "npm run dev --port $FRONTEND_PORT" "frontend"
kill_matching_processes "npm run dev -- --port $FRONTEND_PORT" "frontend"

kill_port_if_busy "$BACKEND_PORT" "backend"
kill_port_if_busy "$FRONTEND_PORT" "frontend"

echo "📦 Starting backend on http://localhost:$BACKEND_PORT ..."
(
  cd "$BACKEND_DIR"
  nohup npm start >"$LOG_DIR/backend.log" 2>&1 &
  echo $! >"$PID_DIR/backend.pid"
)

if ! wait_for_port "$BACKEND_PORT" 15; then
  cleanup_pid_file "$PID_DIR/backend.pid"
  echo "❌ Backend failed to start. Check $LOG_DIR/backend.log"
  exit 1
fi

echo "✅ Backend started (PID: $(cat "$PID_DIR/backend.pid"))"

echo "🐳 Starting AI_workflow_backend..."
(
  cd "$AI_WORKFLOW_DIR"
  compose_cmd down
  compose_cmd up -d
)
echo "✅ AI_workflow_backend started"

echo "🐳 Starting n8n_agent_backend..."
(
  cd "$N8N_AGENT_DIR"
  compose_cmd down
  compose_cmd up -d
)
echo "✅ n8n_agent_backend started"

echo "⚛️  Starting frontend on http://localhost:$FRONTEND_PORT ..."
(
  cd "$FRONTEND_DIR"
  setsid npm run dev -- --port "$FRONTEND_PORT" >"$LOG_DIR/frontend.log" 2>&1 < /dev/null &
  echo $! >"$PID_DIR/frontend.pid"
)

if ! wait_for_port "$FRONTEND_PORT" 20; then
  cleanup_pid_file "$PID_DIR/frontend.pid"
  echo "❌ Frontend failed to start. Check $LOG_DIR/frontend.log"
  exit 1
fi

echo "✅ Frontend started (PID: $(cat "$PID_DIR/frontend.pid"))"
echo ""
echo "✨ All services started successfully!"
echo ""
echo "Service URLs:"
echo "  Backend:  http://localhost:$BACKEND_PORT"
echo "  Frontend: http://localhost:$FRONTEND_PORT"
echo "  Backend log:  $LOG_DIR/backend.log"
echo "  Frontend log: $LOG_DIR/frontend.log"
echo ""
echo "To stop all services, run: ./stop-all.sh"
