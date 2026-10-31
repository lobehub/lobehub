# Upgrade a known LobeBench development database

The original feature branch at `4d02573611` used unpublished draft migrations 0182–0186. The public draft at `0add593474` instead used a consolidated `0198_lobe_bench_environments_and_memory` migration. Canary now owns `0198_goal_visibility`; the feature migration is regenerated as 0199 against that schema. It creates environments and per-attempt memories directly; it never creates/drops legacy Memory scopes or deletes synthetic users.

For the original 0182–0186 drafts, the author reported local `lobe-postgres` databases (`lobechat_bench`, possibly `lobechat`) only, and that original branch was never pushed. The consolidated 0198 draft was later published in PR #22014, so other developers may have applied it. No shared/production execution is known, but that is not proof about other checkouts. The repair recognizes only the complete histories below; unknown histories are refused.

## Fresh or canary databases

Use the normal application migration path. Vercel's build and the Docker startup already run it. Do not run this repair script. No separate production backfill or manual migration is required.

## The exact public 0198 draft

Its recorded timestamp is `1793442088212`, earlier than official goal migration 0198 (`1793450092790`). Therefore normal application migration **does not skip goal visibility for this exact published history**: it applies official 0198 and then feature 0199. The old feature journal record remains, and its idempotent SQL can safely run again as 0199. This timestamp ordering is tested; it is not a guarantee for independently regenerated or edited draft histories.

For a canonical journal without that superseded record, use the local repair below **before** normal application migration. It accepts only canonical 0000–0197 followed by the exact public draft timestamp and SQL hash `3ae81e3241c84b47974a78b4fee2212ed788b35581b1a9d97b7397ee5c18d9d7`. It replaces that one record and applies official 0198 plus feature 0199 atomically. If normal migration has already appended both migrations, the schema is current, but this repair refuses the extra historical row; do not manually delete it to satisfy the checker. No repair is required for that already migrated schema.

## Existing local feature database

Do not start the integrated application against it before completing this procedure. Drizzle decides what to apply using migration timestamps; merely renumbering SQL files can skip upstream migrations on this divergent history.

1. Stop every application/worker that writes the database. Save a custom-format `pg_dump` backup outside the repository, including the `drizzle` schema. Keep the original branch and original database available for rollback. Do not copy credentials into this document or shell history.

2. Restore the backup into a separate local scratch database. Verify the restore succeeds and record counts of cases, environments, runs, run topics, messages, and eval memories. Use a dedicated environment variable such as `LOBE_BENCH_UPGRADE_URL` for this scratch database's connection string; this script never reads `.env` or falls back to `DATABASE_URL`.

3. Diagnose the restored clone (read-only by default):

   ```sh
   bun scripts/upgradeLobeBenchDatabase/index.ts --url-env LOBE_BENCH_UPGRADE_URL --database lobebench_upgrade_check
   ```

4. Only if diagnosis recognizes a complete supported history, upgrade the clone. Supported histories are canonical 0000–0181 plus all five original draft hashes/timestamps (`legacy`), or canonical 0000–0197 plus the exact public 0198 draft (`published`):

   ```sh
   bun scripts/upgradeLobeBenchDatabase/index.ts --url-env LOBE_BENCH_UPGRADE_URL --database lobebench_upgrade_check --apply --backup /absolute/path/lobebench-before-upgrade.dump
   ```

   The script removes only the recognized superseded journal records: five records followed by canonical 0182–0199 for `legacy`, or one record followed by official 0198 and feature 0199 for `published`. Both paths run in **one transaction**. Existing environment, case, run, result, and Memory rows are kept; goal rows gain the upstream `public` visibility default. The final feature migration is idempotent. Any failed constraint, unexpected legacy scope table, partial migration history, changed hash, or unrecognized extra journal entry aborts the repair and rolls back the whole transaction. A completed canonical history is a no-op.

5. Compare the saved counts and representative raw trajectories/Judge reasons/Memory payloads. Verify the actual `goals.visibility` column is non-null with the `public` default and `goals_workspace_visibility_idx` exists; do not rely only on journal rows. Start the integrated application against the upgraded clone and verify it before replacing the local database. Keep the old database stopped and the backup until that verification is accepted. Alternatively repeat the same reviewed procedure on the original local database after taking a fresh backup; name that target explicitly.

The script verifies that the backup archive is readable, not that its contents belong to the selected database or that it was restored successfully. Step 2 is essential. It does not attempt repair of incomplete draft histories or unknown schema changes; investigate those separately instead of deleting journal entries by number.

Tests in `packages/database/tests/lobeBenchMigration.test.ts` use in-memory PGlite only: fresh replay, latest canary upgrade, populated original draft upgrade, normal public-0198 upgrade, exact public-history repair, rerun, unknown-history refusal, and transactional rollback after goal DDL. SQL fixtures are exact copies from `4d02573611` and public `0add593474`, outside the deployment migration directory. No live application database was migrated during development of this integration.
