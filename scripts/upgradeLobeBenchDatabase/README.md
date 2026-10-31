# Upgrade an unpublished LobeBench development database

The feature branch at `4d02573611` used draft migrations 0182–0186. Canary independently used those numbers and now ends at 0197. The released feature migration is 0198, generated against canary's final schema. It creates environments and per-attempt memories directly; it never creates/drops legacy Memory scopes or deletes synthetic users.

Known deployment history: the author reported local `lobe-postgres` databases (`lobechat_bench`, possibly `lobechat`) only. No shared/production execution is known, and the product branch was never pushed. This is not proof about other developers' checkouts. Unknown histories are refused.

## Fresh or canary databases

Use the normal application migration path. Vercel's build and the Docker startup already run it. Do not run this repair script. No separate production backfill or manual migration is required.

## Existing local feature database

Do not start the integrated application against it before completing this procedure. Drizzle decides what to apply using migration timestamps; merely renumbering SQL files can skip upstream migrations on this divergent history.

1. Stop every application/worker that writes the database. Save a custom-format `pg_dump` backup outside the repository, including the `drizzle` schema. Keep the original branch and original database available for rollback. Do not copy credentials into this document or shell history.

2. Restore the backup into a separate local scratch database. Verify the restore succeeds and record counts of cases, environments, runs, run topics, messages, and eval memories. Use a dedicated environment variable such as `LOBE_BENCH_UPGRADE_URL` for this scratch database's connection string; this script never reads `.env` or falls back to `DATABASE_URL`.

3. Diagnose the restored clone (read-only by default):

   ```sh
   bun scripts/upgradeLobeBenchDatabase/index.ts --url-env LOBE_BENCH_UPGRADE_URL --database lobebench_upgrade_check
   ```

4. Only if the complete 0000–0181 canonical prefix and all five known draft hashes/timestamps match, upgrade the clone:

   ```sh
   bun scripts/upgradeLobeBenchDatabase/index.ts --url-env LOBE_BENCH_UPGRADE_URL --database lobebench_upgrade_check --apply --backup /absolute/path/lobebench-before-upgrade.dump
   ```

   The script removes only the five recognized draft journal records, then replays canonical 0182–0198 in **one transaction**. Existing environment, case, run, result, and Memory rows are kept. The final 0198 migration is idempotent. Any failed constraint, unexpected legacy scope table, partial migration history, changed hash, or unrecognized extra journal entry aborts the repair and rolls back the whole transaction. A completed canonical history is a no-op.

5. Compare the saved counts and representative raw trajectories/Judge reasons/Memory payloads. Start the integrated application against the upgraded clone and verify it before replacing the local database. Keep the old database stopped and the backup until that verification is accepted. Alternatively repeat the same reviewed procedure on the original local database after taking a fresh backup; name that target explicitly.

The script verifies that the backup archive is readable, not that its contents belong to the selected database or that it was restored successfully. Step 2 is essential. It does not attempt repair of incomplete draft histories or unknown schema changes; investigate those separately instead of deleting journal entries by number.

Tests in `packages/database/tests/lobeBenchMigration.test.ts` use in-memory PGlite only: fresh replay, canary upgrade, populated legacy upgrade, rerun, unknown-history refusal, and transactional rollback. Legacy SQL fixtures are exact copies from `4d02573611` for those tests, outside the deployment migration directory. No live application database was migrated during development of this integration.
