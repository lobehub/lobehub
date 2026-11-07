---
id_prefix: perf
verify: true
skip_when: no server/db/loop/render-path code touched (docs, copy, pure type changes)
---

# Performance

Will this change be slow, leak, or block — at production data volume, not dev-fixture volume? Database migrations are checked here too (both locking behavior and idempotency: the review target is the migration file, so the rules live together).

Scope boundary: migration **cost** (lock level, duration, re-runnability) is yours; migration **reversibility** (destructive DDL, data loss, rollback and deploy ordering) belongs to `release-risk`. Review the same file from your angle only and do not restate theirs. Likewise for polling: whether the loop is _well-behaved_ (backoff, stop condition, tunable interval) is yours; whether its cost is _visible after ship_ belongs to `observability`.

## Quick checklist

- N+1: per-item queries/fetches inside a loop that a join/batch endpoint would collapse
- Blocking calls on hot paths: synchronous fs/crypto in request handlers, un-batched sequential awaits that could be `Promise.all`, blocking work added to startup/entry paths
- Resource leaks: listeners/intervals/subscriptions/AbortControllers created without cleanup (React effects, service singletons)
- **Polling mechanics**: an added or widened poll/interval needs three things — backoff on failure (otherwise an outage turns into a retry storm), a stop condition when the tab is hidden or the data can no longer change, and a frequency that lives in config rather than as a hardcoded literal nobody can raise without a deploy. Total requests = users × frequency × session length; state that arithmetic rather than calling it "frequent"
- Long-lived objects or callbacks built from closures that capture a large enclosing scope — the closure retains the whole scope for the object's lifetime; copy the needed fields instead
- Render-path waste: heavy computation in render without memoization, unstable identities re-rendering large lists, missing virtualization for unbounded lists
- Unbounded growth: caches/maps/arrays that only ever grow
- **Migration locking**: DDL that takes ACCESS EXCLUSIVE long enough to block production queries — adding a column with a volatile default, non-`CONCURRENTLY` index creation on a large table, table rewrites (`ALTER COLUMN TYPE`), `NOT NULL` on existing columns without a prior validated constraint
- **Migration idempotency**: statements must guard with `IF NOT EXISTS` / `IF EXISTS` so a re-run cannot fail half-applied

## Rule sources (deep mode: read before reviewing)

- `.agents/skills/db-migrations/SKILL.md` — migration workflow, idempotency, regeneration rules
- `.agents/skills/drizzle/SKILL.md` — query patterns, index conventions
- `.agents/skills/data-fetching-architecture/SKILL.md` — where fetching/caching belongs when the diff adds client data flows

## How to check

1. For each loop in the diff, ask what the iteration count is at production scale and whether each iteration does IO.
2. For each new query, check whether it runs per-render, per-item, or per-request, and whether an existing batched path exists.
3. For migrations: read the generated SQL (not just the schema diff); classify each DDL statement by lock level and duration on a large table; check every statement for idempotency guards.
4. For React: check dependency arrays and identity stability of props passed into memoized children/lists.
5. For each poll/interval in the diff, read the hook for a failure branch (does it back off?), a visibility/terminal-state guard (does it ever stop?), and where the frequency is defined.

## Violations

- A concrete path where latency, memory, or lock time grows with data volume introduced or worsened by this diff.
- Migration SQL that blocks reads/writes on a production-sized table or fails on re-run.
- Polling or an interval with no backoff, no stop condition when hidden or terminal, or a hardcoded frequency.

## Not violations

- Micro-optimizations with no measurable path (string concat in a settings handler, one extra render of a small component).
- Costs on genuinely cold paths (one-shot scripts, dev tooling) unless egregious.
- Patterns the codebase already uses at the same scale without incident (calibration principle) — flag only if this diff increases the exposure.
