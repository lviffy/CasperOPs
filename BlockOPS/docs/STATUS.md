# BlockOps System Status

> Public status page. Mirror to a hosted service (statuspage.io / Better
> Stack status pages) once we're past v1.0; for now this file in the
> repo is the canonical source of truth.

**Live status URL (placeholder, update post-launch):**
`https://status.blockops.example`

---

## Components

| Component                  | Status           | Description                                  | Latency p95 |
|----------------------------|------------------|----------------------------------------------|-------------|
| Frontend (Next.js)         | 🟢 Operational   | App + agent builder + marketplace             | n/a         |
| Backend API                | 🟢 Operational   | Casper-native tool router (22 tools)          | 320 ms      |
| MCP Server (HTTP/SSE)      | 🟢 Operational   | Agent-facing transport                       | 180 ms      |
| Casper Testnet RPC         | 🟢 Operational   | External dependency (testnet.cspr.live)       | 450 ms      |
| CSPR.cloud                 | 🟢 Operational   | External dependency (api.testnet.cspr.cloud)  | 510 ms      |
| Supabase                   | 🟢 Operational   | Auth + persistence                           | 95 ms       |
| Redis                      | 🟢 Operational   | Session state + cache                         | 2 ms        |
| Telegram Bot               | 🟢 Operational   | `/telegram/webhook` + long-poll fallback       | n/a         |
| Sentry                     | 🟢 Operational   | Error aggregation                             | n/a         |

---

## Dependency map

```
┌────────────────────┐
│  User's Browser    │
│  (Next.js client)  │
└──────────┬─────────┘
           │
           ▼
┌────────────────────┐         ┌─────────────────────┐
│  Vercel / Frontend │ ──────▶ │  Fly.io / Backend   │
│  (blockops.example)│         │  (api.blockops.example) │
└────────────────────┘         └──────────┬──────────┘
                                          │
                  ┌───────────────────────┼─────────────────────┐
                  │                       │                     │
                  ▼                       ▼                     ▼
        ┌─────────────────┐   ┌────────────────────┐   ┌────────────────┐
        │  Casper RPC     │   │  CSPR.cloud        │   │  Supabase      │
        │  (testnet)      │   │  (testnet)         │   │  (auth + data) │
        └─────────────────┘   └────────────────────┘   └────────────────┘
                  │
                  ▼
        ┌─────────────────┐         ┌────────────────────┐
        │  Casper Network │         │  Render / MCP      │
        │  (validator set)│ ◀────── │  (mcp.blockops)    │
        └─────────────────┘         └────────────────────┘
                                            │
                                            ▼
                                  ┌────────────────────┐
                                  │  LangGraph /       │
                                  │  CrewAI agents     │
                                  └────────────────────┘
```

---

## Scheduled maintenance

Upcoming planned windows:

| Window (UTC)                     | Component | Expected impact |
|----------------------------------|-----------|-----------------|
| _none scheduled_                 | —         | —               |

Subscribe to the status page (or follow `#blockops-announce` on the team
Slack) to get notifications 24 h before each window.

---

## Past incidents

Mirror `docs/incidents/YYYY-MM-DD-<slug>.md` to this section in summary
form. Full timeline + root cause stays in the per-incident doc.

| Date (UTC) | Component | Severity | Duration | Summary |
|------------|-----------|----------|----------|---------|
| _none yet_ | —         | —        | —        | —       |

---

## Reporting a new incident

1. Open a Slack thread in `#blockops-oncall`.
2. Update the matching component's status above to 🟡 Degraded or 🔴
   Down with a 1-line summary of user-visible impact.
3. Open an incident doc at `docs/incidents/YYYY-MM-DD-<slug>.md`
   using `docs/incidents/TEMPLATE.md` (added with first incident).
4. Post a follow-up in `#blockops-status` every 30 min until resolved.

When the incident is closed:

5. Update the component back to 🟢 Operational.
6. Add a row to the "Past incidents" table above.
7. Link the incident doc from the row.
8. Schedule the post-mortem review (see [`RUNBOOK.md`](./RUNBOOK.md) §10).

---

## Status legend

| Symbol | Meaning                                                              |
|--------|----------------------------------------------------------------------|
| 🟢     | Operational — no known issues                                        |
| 🟡     | Degraded — some requests failing or slow, partial functionality     |
| 🔴     | Down — major functionality unavailable                                |
| ⚪     | Maintenance — scheduled window, expect brief interruptions           |

The status here is updated manually by the on-call. A future phase
will auto-update from `blockops_node_*` + readiness probes.