---
id_prefix: perf
verify: true
skip_when: no server/db/loop/render-path code touched (docs, copy, pure type changes)
---

# Performance

Will this change be slow, leak, or block — at production data volume, not dev-fixture volume? Database migrations are checked here too (both locking behavior and idempotency: the review target is the migration file, so the rules live together).

## Quick checklist

- N+1: per-item queries/fetches inside a loop that a join/batch endpoint would collapse
- Blocking calls on hot paths: synchronous fs/crypto in request handlers, un-batched sequential awaits that could be `Promise.all`, blocking work added to startup/entry paths
- Resource leaks: listeners/intervals/subscriptions/AbortControllers created without cleanup (React effects, service singletons)
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

## Violations

- A concrete path where latency, memory, or lock time grows with data volume introduced or worsened by this diff.
- Migration SQL that blocks reads/writes on a production-sized table or fails on re-run.

## Not violations

- Micro-optimizations with no measurable path (string concat in a settings handler, one extra render of a small component).
- Costs on genuinely cold paths (one-shot scripts, dev tooling) unless egregious.
- Patterns the codebase already uses at the same scale without incident (calibration principle) — flag only if this diff increases the exposure.
