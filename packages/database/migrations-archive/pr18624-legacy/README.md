# PR18624 legacy migration archive

These SQL files are the deployed legacy sequence from the pre-canary PR18624
worktree. They are retained for legacy database detection and compatibility
replay only. The Drizzle runner is configured for `packages/database/migrations`
and never reads this archive.

The legacy database may contain these migrations at indexes 0149–0157 while
canary uses different migrations at the same indexes. The compatibility bridge
must verify the hashes in `manifest.json` before replaying any canary SQL. It
must not rename these migrations, replace canary journal entries, or invent
missing Drizzle snapshots. The original dirty sequence has no snapshots for
0154–0157; the SQL and journal timestamps are the preserved evidence.

Migration 0154 has two verified byte-level variants at the same `when`:
`0154_document_rewrite_sessions.sql` is the later split-source form, while
`0154_document_rewrite_sessions.executed.sql` is the recovered deployed form.
The bridge accepts exactly those two hashes for 0154 and rejects every other
hash; the other eight legacy migrations remain single-hash exact matches.

The deployment wrapper must call `checkPr18624LegacyHistory` before the normal
`db:migrate` command. A `clean` result skips the bridge. A `legacy` result must
run `runPr18624LegacyBridge` first, then invoke the ordinary runner so canary
0159–0161 and the new append-only migration can run. Any partial, tampered, or
unknown-later history fails closed and requires operator investigation.
After either path, call `assertPr18624SchemaShape` so `IF NOT EXISTS` cannot
silently accept a same-name table, column, index, or foreign-key definition
with the wrong shape.

The wrapper should pass the canonical `readMigrationFiles` entries (including
the append-only 0162 entry) as `Pr18624MigrationFile` values and pass later
exact hash/`when` pairs to `checkPr18624LegacyHistory` and
`runPr18624LegacyBridge`. This keeps the bridge outside the normal application
database export and makes the legacy path an explicit deployment operation.

The package test uses PGlite and skips production-only `pg_search`/BM25 SQL;
the release gate must repeat the same clean and legacy sequences with the real
node-postgres/Neon driver against an isolated disposable database before any
shared or production database is considered.
