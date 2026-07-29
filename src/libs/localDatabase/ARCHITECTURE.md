# Local Database Architecture

The local database is a runtime-neutral persistence boundary. SWR cache persistence is its first
consumer, but the database contract and adapters do not depend on SWR.

```text
Repository / feature
        │
        ▼
LocalDatabaseAdapter
   ┌────┴──────────────┐
   ▼                   ▼
IndexedDB          Electron IPC
                        │
                        ▼
               Drizzle query builder
                        │
                        ▼
                   node:sqlite
```

## Ownership

| Layer                            | Responsibility                                                        |
| -------------------------------- | --------------------------------------------------------------------- |
| `src/libs/localDatabase`         | Runtime-neutral contract, adapter registration, IndexedDB adapter     |
| `src/libs/swr/localDataCache.ts` | SWR-specific repository and cache-key semantics                       |
| `apps/desktop/src/main/database` | SQLite client, Drizzle schema, and migration execution                |
| `LocalDatabaseSrv`               | Collection-scoped reads and writes expressed through Drizzle builders |
| Electron IPC                     | Serialization and process-boundary transport only                     |

## Migration invariants

- Migration manifests are append-only and ordered by increasing integer version.
- A released migration is immutable. Schema corrections use a new migration.
- Every SQLite migration runs in its own `BEGIN IMMEDIATE` transaction.
- Applied SQLite migrations record their version, stable name, checksum, and timestamp.
- Startup rejects unknown newer versions and checksum drift instead of silently mutating history.
- IndexedDB upgrades run inside the browser-provided version-change transaction.
- Data backfills do not belong in schema migrations. Add a resumable, idempotent process when a
  future collection requires retained data.

## Adding a SQLite migration

1. Update `apps/desktop/src/main/database/schema.ts`.
2. Run `pnpm run db:generate:local` from `apps/desktop`.
3. Review the generated SQL, snapshot, and journal under `database/migrations/drizzle`.
4. Give the generated file a stable, descriptive name before the migration is released.
5. Keep statements idempotent where SQLite supports it.
6. Add a migration-runner regression test for the observable schema or data transition.
7. Run the desktop service tests, desktop type check, and main-process production build.

During development, delete and regenerate the latest unreleased migration artifacts when the schema
changes. Delete the local cache database when testing a replacement draft migration. After release,
the migration becomes immutable and all changes require a new version.

## Adding an IndexedDB migration

1. Append a higher version to `indexedDBMigrations.ts`.
2. Keep the migration synchronous so it remains inside `onupgradeneeded`'s active transaction.
3. Use the supplied version-change transaction for data-preserving object-store transformations.
4. Add a regression test for both the upgrade boundary and the resulting store behavior.
