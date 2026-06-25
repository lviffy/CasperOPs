# Retrospective — <YYYY-Qx or event name>

> **Audience:** the whole team. Read this BEFORE the retro meeting
> so the live conversation can focus on actions, not recap.

**Date:** YYYY-MM-DD
**Author:** @yourname
**Sprint / period covered:** YYYY-MM-DD → YYYY-MM-DD
**Attendees:** @alice, @bob, …

## TL;DR

Three sentences max. What happened, what worked, what broke.

- …
- …
- …

## What worked

Things we should keep doing. Cite specific incidents / numbers.

1. …
2. …
3. …

## What broke

Things that surprised us or caused user-facing pain. Cite the
[`RUNBOOK.md` §10 post-incident checklist](./RUNBOOK.md#10-post-incident-checklist)
entries that landed.

### Incidents this period

| Date | Severity | Duration | Summary | Doc |
|------|----------|----------|---------|-----|
| YYYY-MM-DD | P2 | 23 min | Deploy stuck pending — see [RUNBOOK §1](./RUNBOOK.md#1-deploy-stuck-pending--5-minutes) | [incident doc] |
| … | … | … | … | … |

### Recurring issues

| Pattern | Frequency | First seen | Action owner |
|---------|-----------|------------|--------------|
| Redis flush events | 2 / week | YYYY-MM-DD | @alice (Phase 30 cache TTL tuning) |
| … | … | … | … |

## User feedback

Quote 2-3 representative bug reports / Discord threads / Twitter
mentions verbatim. Anonymous them if needed.

> "I lost 30 minutes because the deploy was stuck pending and I didn't
> know to re-broadcast." — Discord user, 2026-MM-DD

> "The x402 payment flow worked perfectly the first time, but the
> second time the refund broadcast never happened." — Twitter, …

## What to fix next

Actionable, time-bound, owner-assigned items. Cap at 5 — if you have
more, prioritise ruthlessly.

| Action | Owner | Due | Tracking |
|--------|-------|-----|----------|
| Reduce deploy-stuck SLA from 5 min → 2 min via better polling | @bob | YYYY-MM-DD | GitHub issue #123 |
| Add `flushall` audit log to Redis alerts | @alice | YYYY-MM-DD | GitHub issue #124 |
| … | … | … | … |

## What we learned

Free-form. Things that aren't actionable but worth remembering. Each
item should be 1-2 sentences.

- The failover layer we shipped in Phase 30 saved us when the public
  Casper RPC had a 14-minute outage — would have been a P0 without it.
- …
- …

## Open questions

Things we don't have an answer to yet. Bring these to the retro.

- Are we over-rotating the tier limits too aggressively? Pro users
  haven't complained yet but free users hit the limit in week 1.
- …

## Appendix

### Metrics this period

- Total tool invocations: …
- p95 latency: …
- Error rate: …
- New signups: …
- Revenue: …

### Links

- Sentry: https://sentry.io/organizations/blockops/
- Grafana: https://grafana.blockops.example/d/blockops-slo
- Status page: https://status.blockops.example