# Changelog

All notable changes to CasperOPs are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Tier-based API key flow (`free` / `pro` / `enterprise`)
- Self-serve API key management page (`/api-keys`)
- Public pricing page (`/pricing`)
- Public API reference (`docs/PUBLIC_API.md`)

### Changed
- Per-tool rate limits now tier-aware (free 60/min, paid 20/min,
  write 10/min)

## [1.0.0] - 2026-Q3

### Added
- **Phase 29**: Mainnet launch — Casper Network mainnet is the
  default target; `CASPER_NETWORK` env var selects the chain.
- **Phase 28**: Live testnet v1.0 deployment script +
  `docs/PHASE28_RUNBOOK.md` for the human-driven deploy.
- **Phase 27**: Redis-backed read-through cache for `get_balance`,
  `get_reputation`, `get_token_info`, `get_token_balance`,
  `fetch_price`, `lookup_deploy`, `lookup_block`. Per-tool rate
  limits. Hot-path DB indexes. k6 load test scripts (baseline,
  paid-tools, workflow-execute).
- **Phase 26**: Prometheus `/metrics` endpoint on backend + MCP,
  admin-gated `/health/diag`, Sentry alert rules in
  `docs/OPERATIONS.md`, top-8-incident `docs/RUNBOOK.md`, public
  `docs/STATUS.md`.
- **Phase 25**: Playwright E2E suite (22 tests), per-route
  `error.tsx` + `loading.tsx` files, mobile responsiveness audit,
  axe-core accessibility audit (all 5 audited pages WCAG 2.1 AA).
- **Phase 24**: Production containerization — Dockerfiles
  (backend, frontend, MCP), `docker-compose.yml`, env validation,
  `health/{live,ready,startup}` probes, `docs/DEPLOYMENT.md`,
  `scripts/deploy-{backend,frontend,mcp}.sh`.
- **Phase 23**: EVM controller removal — deleted 11 EVM routes +
  `safeRequire`/`deprecatedRouter` shims; backend is Casper-only.

### Changed
- v1 tool surface now serves 22 tools (up from 19 in Phase 19,
  added `lookup_block`, `list_reminders`, `cancel_reminder`).
- CSPR.click is the only supported wallet (Lit/Arbitrum removed).

## [0.9.0] - 2026-Q2

### Added
- **Phase 22**: Live testnet re-deployment — 18-step e2e + 12
  Phase 22 hardening checks, dryrun mode for CI.
- **Phase 21**: MCP server HTTP/SSE transport, sample agents.
- **Phase 20**: Observability — Sentry wired through, structured
  logging, env validation, canonical v1 tool surface.
- **Phase 19**: Production hardening — test coverage to 100% of
  public surface, rate limiting, structured errors.
- **Phase 17**: v1.0 contract hardening — security-audit TODOs,
  `set_paused`, `transfer_ownership`.
- **Phase 16**: Live testnet deployment of v1.0 contracts.
- **Phase 15**: Test suite repair — CI green, 100+ tests.
- **Phase 14**: Documentation + onboarding — `docs/API.md`,
  `docs/ARCHITECTURE.md`, `docs/DEV_SETUP.md`, `docs/x402.md`.

### Changed
- Migrated from multi-chain (EVM + Casper) to Casper-only.

## [0.5.0] - 2026-Q1

### Added
- **Phase 13**: Deprecation cleanup — removed EVM dead code after
  Phase 6 shipped CSPR.click.
- **Phase 12**: Observability, security, CI — initial Sentry +
  GitHub Actions + rate limiting.
- **Phase 11**: Database schema migration to Casper-native
  (deploy_history, tool_executions, reputation_events).
- **Phase 10**: MCP server production deployment on Render.
- **Phase 9**: x402 payment protocol on Casper — CSPR.transfer
  challenge envelope, deploy verify, refund-on-failure.
- **Phase 8**: CSPR.click UX hardening — error boundaries,
  retry-on-disconnect, transaction queue.
- **Phase 7**: Casper testnet deployment + end-to-end validation.
- **Phase 6**: Legacy frontend migration — CSPR.click everywhere.

## [0.1.0] - 2025-Q4

### Added
- Initial release.
- **Phase 5**: Verification + E2E testing.
- **Phase 4**: AI workflow + MCP server integration.
- **Phase 3**: Frontend visual builder + wallet connect.
- **Phase 2**: Backend API cleanup + Casper alignment.
- **Phase 1**: Smart contract validation + deployment.