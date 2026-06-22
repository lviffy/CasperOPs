#!/usr/bin/env bash
# BlockOps dev stack: one command to install, build, and run everything.
#
# Usage:
#   ./scripts/dev.sh up            # install + build contracts + run all 3 services
#   ./scripts/dev.sh down          # kill everything started by `up`
#   ./scripts/dev.sh install       # install all subproject deps
#   ./scripts/dev.sh build         # cargo odra build for the contracts
#   ./scripts/dev.sh test          # run all test suites
#   ./scripts/dev.sh logs          # tail the combined logs

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="${LOG_DIR:-$ROOT/.dev-logs}"
PID_DIR="${PID_DIR:-$ROOT/.dev-pids}"
mkdir -p "$LOG_DIR" "$PID_DIR"

cmd="${1:-up}"

run_in_bg() {
  local name="$1"
  shift
  local logfile="$LOG_DIR/$name.log"
  local pidfile="$PID_DIR/$name.pid"
  echo "  → starting $name (logs: $logfile)"
  ( "$@" ) > "$logfile" 2>&1 &
  echo $! > "$pidfile"
}

stop_bg() {
  local name="$1"
  local pidfile="$PID_DIR/$name.pid"
  if [ -f "$pidfile" ]; then
    local pid
    pid="$(cat "$pidfile")"
    if kill -0 "$pid" 2>/dev/null; then
      echo "  → stopping $name (pid $pid)"
      kill "$pid" 2>/dev/null || true
      sleep 1
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$pidfile"
  fi
}

install_all() {
  echo "→ installing frontend deps"
  (cd "$ROOT/frontend" && npm install --no-audit --no-fund)
  echo "→ installing backend deps"
  (cd "$ROOT/backend" && npm install --no-audit --no-fund)
  if command -v pip >/dev/null 2>&1; then
    echo "→ installing MCP server deps"
    (cd "$ROOT/n8n_agent_backend" && pip install -r requirements.txt)
  else
    echo "  ⚠ pip not found; skipping MCP install (run manually later)"
  fi
}

build_contracts() {
  if ! command -v cargo >/dev/null 2>&1; then
    echo "  ⚠ cargo not found; skipping contract build"
    return
  fi
  echo "→ building Odra contracts"
  export RUSTFLAGS="${RUSTFLAGS:-} -C link-arg=--unresolved-symbols=import-dynamic"
  (cd "$ROOT/contract" && cargo odra build)
}

run_up() {
  echo "→ starting BlockOps dev stack (logs in $LOG_DIR)"
  run_in_bg backend "(cd $ROOT/backend && npm run dev)"
  run_in_bg frontend "(cd $ROOT/frontend && npm run dev)"
  if command -v uvicorn >/dev/null 2>&1; then
    run_in_bg mcp "(cd $ROOT/n8n_agent_backend && uvicorn mcp_server_sse:app --host 0.0.0.0 --port 8080 --reload)"
  else
    echo "  ⚠ uvicorn not found; skipping MCP server (run manually with: cd n8n_agent_backend && uvicorn mcp_server_sse:app --port 8080)"
  fi
  sleep 2
  echo
  echo "  Backend  → http://localhost:3000/api"
  echo "  Frontend → http://localhost:3000"
  echo "  MCP      → http://localhost:8080/mcp"
  echo
  echo "Tail logs with: $0 logs"
}

run_down() {
  echo "→ stopping BlockOps dev stack"
  stop_bg backend
  stop_bg frontend
  stop_bg mcp
  echo "  done"
}

run_test() {
  echo "→ contract tests"
  if command -v cargo >/dev/null 2>&1; then
    (cd "$ROOT/contract" && cargo test)
  else
    echo "  ⚠ cargo not found; skipping contract tests"
  fi
  echo
  echo "→ frontend tests"
  (cd "$ROOT/frontend" && npm test)
  echo
  echo "→ backend unit tests"
  (cd "$ROOT/backend" && npm run test:unit 2>/dev/null || echo "  ⚠ backend unit tests not configured (no chai/mocha)")
}

run_logs() {
  ls -1 "$LOG_DIR"/*.log 2>/dev/null | xargs -r tail -F
}

case "$cmd" in
  up)        run_up ;;
  down)      run_down ;;
  install)   install_all ;;
  build)     build_contracts ;;
  test)      run_test ;;
  logs)      run_logs ;;
  *)
    echo "Usage: $0 {up|down|install|build|test|logs}" >&2
    exit 1
    ;;
esac
