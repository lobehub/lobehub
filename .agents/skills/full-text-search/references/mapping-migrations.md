# Mapping migration workflow

Use this reference when changing Elasticsearch field definitions or operating index generations.
For initial provider cutover and complete environment setup, use
`docs/self-hosting/advanced/elasticsearch-migration.mdx` from the OSS repository root.

## Choose the operation

- Add a new numbered batch under `ftsSearchDocument/migration/` with complete definitions for the
  changed entities and bumped `schemaVersion` values; keep the current Zod schema and projection
  consistent. Register the batch and update current pointers in `migration/index.ts`, then append
  expected fingerprints in `__tests__/schemaSnapshots.json`. Preserve old batches and baselines;
  the PR history guard rejects changes to batch directories and JSON entries present in the base.
  The mapping and history tests reject missing registrations, stale pointers and version bumps
  without physical changes. Shared analysis changes require
  version bumps and rebuilds for every entity, even if only one uses the analyzer being changed.
- Docker startup with `FTS_SEARCH_PROVIDER=elasticsearch` runs `--startup --yes` after PostgreSQL
  migrations and before serving requests. It checks the declared versions, backfills required
  generations, drains pending changes, and promotes them. An unchanged completed generation is
  not scanned again. Other entrypoints retain explicit operator control.
- Rebuild into a new generation for field type/analyzer changes, removals, or when rollback matters.
  Only entities whose declared version changes need a new generation.
- Before removing or renaming a field, retain its Zod definition, builder output and old property
  in `FTS_SEARCH_RETAINED_SOURCE_PROPERTIES` until every index needing it is closed. New index writes
  omit retained source-only fields. Sync, apply and promotion reject incompatible open targets;
  a type or semantic conversion is not supplied automatically.
- Incompatible same-name JSON type changes are not supported by the online migration path. Use a
  new field name and retain the old source key through the rollback window. If incompatible code
  has already created dead letters, fix the mapping/projection first, then requeue only reviewed
  document ID/revision pairs in PostgreSQL. There is no Outbox requeue CLI flag; `--skip-failure` only
  resolves backfill checkpoint failures. The standalone sync CLI stops while any dead letters remain.
- Use `--in-place` only when status reports `upgrade_available` and `mappingChange: additive`.
  Currently this means new top-level fields; adding a multi-field to an existing field is classified
  as breaking. In-place still scans historical documents to populate the new fields. It preserves
  the physical name and offers no old-generation alias rollback.

## Operator prerequisites and recovery

For explicit operator control, use `bun run fts-search:reindex -- --apply --entity=<entity> --yes`, then
`--promote --entity=<entity> --yes` after catch-up. Optional operations are `--retire`, `--purge`,
`--apply --in-place`, and rollback with `--promote --version=<previous-version>`; each requires the
target entity and confirmation. See `scripts/elasticsearchReindex/commandOptions.ts` for supported
combinations and `runtime/generationService.ts` for the operation gates.

- Configure the intended `DATABASE_URL`, `ES_INDEX_NAMESPACE`, `ES_URL`, and endpoint authentication
  (`ES_API_KEY` for authenticated endpoints; the explicit insecure-HTTP opt-in for an appropriate
  local target). Preserve a durable `ES_REINDEX_STATE_DIR` through every step. In containers, mount
  persistent storage; stop the previous worker before copying the whole directory to another worker.
- Without `ES_URL`, `--status` reports `generations: null`: that is missing ES inspection, not proof
  that no upgrade is needed. Inspect `drift`, `unmanaged`, or `rollback_required` rather than forcing
  an upgrade through them. Live metadata still needs a valid run ID and schema version for sync
  readiness; only the legacy fingerprint may be absent.
- Build beside the old live alias with incremental sync running, then promote after backfill
  completion and an idle target-entity Outbox (`pending`, `retrying`, `inFlight`, `dead` all zero). A completed
  backfill does not move an existing alias. Verify actual searches and catch-up before retirement.
- Rollback is an optional recovery branch: select a retained, open older generation first, then
  redeploy matching older code. Older sync code rejects a live generation newer than it declares.
  Unlike forward promotion, rollback may accept an older stamped generation without its checkpoint.
- Retire only while the declared generation is serving and rollback is no longer needed. `--retire`
  only closes eligible old indexes. Explicit `--purge` installs and verifies an exact-index template
  with `allow_auto_create: false` before deletion, requiring `manage_index_templates`. Keep these
  protection templates; conflicts fail closed. An empty Outbox is not a fence against paused workers.
- Mutating commands acquire a non-expiring lock in `<namespace>-fts-search-control`. Status reads
  `migrationLock` without acquiring one. Failed/interrupted commands may retain the lock; stop the
  old process and resolve uncertain requests before `--release-lock=<owner> --yes`. Never use timeout
  takeover. The lock and tombstones cannot protect against older CLI binaries or external mutations.
- In-place widens the live mapping before backfill and pins the physical index in its checkpoint.
  Resume uses ordinary `--apply` with the same directory; no promote/retire step is needed for this
  operation. Metadata can already say `in_sync` while backfill is incomplete, so also inspect run and
  entity progress. It does not preserve a pre-upgrade index for alias rollback; recovery may require
  rebuilding from older code.

## Repeat, resume, and concurrency

The completed-run behavior below assumes the generation still covers the same entities. Adding an
entity to an existing generation reopens its checkpoint for that entity's backfill.

| Situation                                       | Actual behavior and operator action                                                                                                                 |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Same namespace/version, completed checkpoint    | Backfill returns without scanning or bulk-writing again. Preparation/status work can still run.                                                     |
| Same checkpoint, incomplete run                 | Reuses run ID, skips completed entities, and continues after saved cursors. An uncheckpointed batch may be replayed.                                |
| Missing checkpoint, existing indexes            | A new run can be rejected by `_meta.reindex_run_id`; restore the matching checkpoint. This is not a safe way to restart or adopt an existing index. |
| New empty target                                | Only this initial installation uses `--apply --fresh-run --yes`. Do not use it to resume or override a conflict.                                    |
| Two workers, same checkpoint directory          | The Elasticsearch namespace lock rejects the second migration owner.                                                                                |
| Two workers, different directories, same target | The same namespace lock still rejects the second owner, including different source databases targeting that ES namespace.                           |

Repeating `--promote` for a valid already-live target returns `already_live`, without a new Outbox
idle gate. Repeating `--retire` never advances to deletion; use `--purge` explicitly. If in-place
mapping restamping succeeded before its checkpoint was created, repeat `--apply --in-place` after
resolving any residual lock; exact mapping and identity checks allow that intermediate state.

## Large datasets and deployment automation

Both rebuild and in-place backfill scale with the documents scanned, projected, transferred, and
indexed. Measure a representative payload and real resource limits; a fast small synthetic dataset
does not establish production duration. Use bounded `--batch-size`, `--bulk-max-bytes`, and concurrency
options in `scripts/elasticsearchReindex/options.ts`. `--max-batches-per-entity` bounds a rehearsal or pause; exit
code zero alone does not mean the backfill is complete.

For Docker self-hosting, startup migration is a blocking maintenance step, not an image-build step.
The application and manual migration tool must share the same durable `ES_REINDEX_STATE_DIR`.
The official Compose file mounts the existing reindex volume on both. Do not silently adopt indexes
after checkpoint loss or steal a retained lock: restore progress and use explicit owner recovery
after confirming the old process and uncertain requests have stopped. Keep the separate continuous
sync worker running on the same application version after startup.

For large hosted deployments, keep the existing explicit migration workflow and isolated preview
targets. Retain completion/fingerprint/Outbox gates before promotion; starting a migration does not
mean the migration or traffic switch is complete. No durable task orchestration is supplied here.

## Local Docker rehearsal

Run the relevant existing reindex, mapping, and sync tests for behavioral changes. For operational
claims about generation migration, exercise the real CLI and sync runtime against isolated Docker
PostgreSQL and Elasticsearch with the required ICU plugin. Scope the rehearsal to the changed
behavior; do not require all cases for an unrelated edit. Use synthetic data and record the source
revision, any future-version fixture override, process identities, checkpoint directory, commands,
and raw results. Cover the applicable cases:

- A multi-batch dataset: stop after a bounded batch, start a new process with the same checkpoint,
  and verify the same run ID, advancing cursor, and final active-document count.
- A completed repeat with source data static and sync inactive: compare per-session bulk events and
  ES indexing counters. Test a missing checkpoint separately; do not call its error a no-op.
- A per-entity upgrade with source insert/update/delete while backfilling: verify both generations,
  per-generation field pruning, and the unchanged live alias before promotion. Prove pending work
  blocks promotion, then drain and verify only the selected alias switches.
- Rollback while the previous generation remains available; close, fresh target-resolution cycle,
  and delete after returning to the declared generation.
- Additive in-place upgrade: same physical index, populated new field, cross-process resume, and no
  bulk writes on completed repeat. Check run progress as well as metadata.
- For deployment/concurrency changes, run same-directory and different-directory workers and report
  duplicate work or identity rejection separately from data correctness.

Keep deleted-document tombstones separate from active search counts. Do not infer crash-window
recovery, uninterrupted search under load, or hosted build persistence from a normal bounded pause.
Report measured payload size and timings without extrapolating a production completion time.
