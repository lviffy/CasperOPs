# Final Go-Live Checklist (T-0)

> **Print this, take it to the launch war room.**
> Each item is binary — done or not done. No "in progress" boxes.

This is the SHORTER companion to [`MAINNET_LAUNCH.md`](./MAINNET_LAUNCH.md);
it strips everything but the T-0 items so the operator can run through
them in under 10 minutes.

## 5 minutes before launch

- [ ] **DNS verified.** `casperops.example`, `api.casperops.example`,
      `mcp.casperops.example` all resolve to Cloudflare.
- [ ] **CDN live.** Cloudflare in front of the backend (orange-cloud
      proxy enabled, TLS 1.3 minimum, HSTS preload ready).
- [ ] **Sentry DSNs populated** in both backend (`SENTRY_DSN`) and
      frontend (`NEXT_PUBLIC_SENTRY_DSN`). Verify by loading the
      frontend and triggering a test error.
- [ ] **Status page live** and reporting green for every component.
      URL: `https://status.casperops.example`.
- [ ] **Uptime monitor configured.** Verify by hitting
      `/health/ready` on each component from a fresh
      monitor (Better Stack / UptimeRobot).

## 1 minute before launch

- [ ] **Twitter / X launch post drafted** (paste it in a pinned DM
      so you can paste it out instantly).
- [ ] **Discord launch post drafted** (same).
- [ ] **GitHub release `v1.0.0` published** with the binary
      checksums (changelog auto-populated from `git log`).

## GO

- [ ] Deploy mainnet contracts (`./scripts/deploy-mainnet.sh --confirm`)
- [ ] Update env store with the new contract hashes
- [ ] Deploy backend to Fly.io (`./scripts/deploy-backend.sh prod`)
- [ ] Deploy frontend to Vercel (`./scripts/deploy-frontend.sh prod`)
- [ ] Deploy MCP to Render (`./scripts/deploy-mcp.sh deploy`)

## Post-launch (next 30 minutes)

- [ ] **Verify all 3 services respond.** `curl -fsS https://api.casperops.example/health/ready | jq .`
- [ ] **Verify a paid tool flow end-to-end.** Sign a CSPR.click
      payment deploy → call a paid tool → confirm tool executes.
- [ ] **Verify Sentry is quiet.** No new errors in the dashboard.
- [ ] **Verify Grafana dashboards show traffic.** `casperops_http_requests_total` ticking.
- [ ] **Verify status page stays green** for the first 30 minutes.
- [ ] **Post the launch announcement** (Twitter + Discord).
- [ ] **Email the waitlist** (subject: "CasperOPs v1.0 is live").
- [ ] **Archive the testnet deployer key** to cold storage (1Password + offline USB).
      Do NOT delete — the v1.0.0-rc.1 events on CSPR.cloud are linked to it.
- [ ] **Tag the release** as `v1.0.0` on GitHub (if not done as part of the deploy).

## Failure modes

If something breaks in the first hour:

1. Freeze the public docs site (Cloudflare "Under Attack Mode")
2. Update status page with the incident
3. Roll back per [`RUNBOOK.md` §9](./RUNBOOK.md#9-rollback-a-deploy)
4. Post a public incident within 30 minutes

If something breaks in the first week:

1. Revert to `v1.0.0-rc.1` (last known-good testnet-tagged build)
2. Re-deploy to mainnet
3. Investigate offline; do NOT push the fix until the post-mortem is signed off

## What "done" looks like

- 99.5%+ backend availability for the first 7 days
- 0 unresolved Sentry P0/P1 incidents after 24 hours
- 1+ paying customer onboarded
- 1+ community-built agent on the marketplace

If you check all 3 boxes in the first week, the launch is successful.
Anything else, we file an honest retro and re-plan for Q+1.