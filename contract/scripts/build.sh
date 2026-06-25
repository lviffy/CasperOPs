#!/usr/bin/env bash
# Build the BlockOps Odra contracts to WASM and run tests.
#
# Usage:
#   ./scripts/build.sh            # cargo test + cargo odra build
#   ./scripts/build.sh test       # cargo test only
#   ./scripts/build.sh wasm       # cargo odra build only
#
# Required toolchain:
#   - rustup toolchain with nightly (rustup override set nightly)
#   - rustup target add wasm32-unknown-unknown --toolchain nightly
#   - WABT (wasm-opt + wasm-strip in PATH). On Arch Linux:
#       sudo pacman -S wabt
#
# Required env vars (only for deploy, not for build):
#   CASPER_RPC_URL, CASPER_SECRET_KEY, CASPER_AGENT_FACTORY_HASH, ...

set -euo pipefail

cd "$(dirname "$0")/.."

# Path to wabt tools (override if installed elsewhere).
WABT_BIN="${WABT_BIN:-/tmp/wabt-1.0.36/bin}"
DART_BIN="${DART_BIN:-/opt/dart-sdk/bin/utils}"
export PATH="$WABT_BIN:$DART_BIN:$PATH"

# Host functions (casper_*) are provided at deploy time, not link time.
# Allow rust-lld to pass them through as wasm imports.
export RUSTFLAGS="${RUSTFLAGS:-} -C link-arg=--unresolved-symbols=import-dynamic"

ensure_toolchain() {
  if ! rustup target list --installed | grep -q "wasm32-unknown-unknown"; then
    rustup target add wasm32-unknown-unknown
  fi
  if ! rustup toolchain list | grep -q nightly; then
    rustup toolchain install nightly
    rustup target add wasm32-unknown-unknown --toolchain nightly
  fi
}

mode="${1:-all}"
ensure_toolchain

case "$mode" in
  test)
    cargo test
    ;;
  wasm)
    cargo odra build
    ;;
  all|"")
    cargo test
    echo
    cargo odra build
    ;;
  *)
    echo "Usage: $0 [test|wasm|all]" >&2
    exit 1
    ;;
esac
