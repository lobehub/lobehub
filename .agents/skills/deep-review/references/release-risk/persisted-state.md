# Persisted State and Deploy-Moment Risk

Read this reference when the diff touches migrations, schema, structured values stored without a
schema migration, queues, workflows, cron jobs, configuration, or outbound side effects.

## Persisted state

- Read every migration and generated SQL statement in full. Additive, reversible changes such as a
  nullable column, new table, or concurrent index produce no finding or release check unless a
  concrete ordering or production-state dependency exists.
- Flag destructive DDL (`DROP`, narrowing type changes, enum-value removal), data-mutating
  migrations without a reconstruction path, and constraints that may reject existing rows.
- Check `ON DELETE CASCADE` additions for newly widened deletion effects.
- Treat structured values without DDL as persisted contracts:
  - `jsonb` keys and value types
  - Redis/cache objects
  - localStorage, IndexedDB, and persisted stores
  - manifests or JSON blobs in object storage
    Compare the writer's new shape with every reader. Old values remain until explicitly migrated or
    expired; a reader must tolerate the legacy shape.
- State rollback asymmetry and deploy ordering explicitly. If reverting code while keeping the new
  schema breaks the previous version, the release has crossed a one-way compatibility boundary.

## Dev-cycle drift

- Read this PR's migrations as a series. If the same PR creates an object and later renames, drops,
  or reworks it, squash the unshipped intermediate states into the final shape.
- Reject migration statements whose only purpose is accommodating a developer database state that
  production has never seen.
- Cross-check every table and column used by the diff against committed schema and migrations. A
  local database can contain residue that production will never create.
- Check ordering after rebases: trunk migrations must run first without colliding with this branch.
- What cannot be settled from the repo becomes one precise release check, such as replaying the
  migrations on a clean database or counting rows that would violate a new constraint.

Do not recommend squashing migrations that already ran in any shared environment. They are history,
not development residue.

## Deploy-moment state

- Queued messages and in-flight workflows were produced by the old code. When payload fields or
  workflow-step ordering change, keep consumers backward-compatible for at least one deploy cycle
  or document a drain-and-deploy procedure.
- A cron or scheduled job runs against production-scale backlog on its first tick. Check
  idempotency, scope, and whether a schedule change can overlap the old schedule.
- For new configuration, verify declaration, default/failure behavior, and every deployment target.
  Unknown live values become release checks; missing declarations in code are findings.
- Trace bulk writes for irreversible fan-out: email, push, payment calls, and third-party webhooks.
  A rollback cannot recall an outbound effect.

## Verification guidance

- Confirm data hazards from the actual SQL and readers, not from the presence of a migration.
- A `jsonb` or cache-shape finding survives only when a real legacy value reaches a reader that
  cannot handle it.
- Dev-cycle churn exists only when this PR both creates and later reworks the same object.
- Separate migration cost and locking (`performance`) from reversibility and recovery cost (this
  dimension).

## Severity

- **P0**: destructive or incompatible change that cannot be safely undone, or a migration that will
  fail against data known to exist.
- **P1**: legacy records or in-flight payloads can break, but recovery is possible with an explicit
  migration, compatibility reader, or drain procedure.
- **P2**: unshipped migration churn or a missing rollback note with no demonstrated runtime failure.
