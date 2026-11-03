import type { LocalDatabaseMigration } from './types';

const migrationModules = import.meta.glob('./drizzle/*.sql', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;

const migrationName = (path: string) =>
  path
    .split('/')
    .at(-1)!
    .replace(/\.sql$/, '');

/** Generated Drizzle migrations, ordered by their immutable numeric filename prefix. */
export const localDatabaseMigrations: readonly LocalDatabaseMigration[] = Object.entries(
  migrationModules,
)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([path, source], index) => ({
    name: migrationName(path),
    statements: source
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter(Boolean),
    version: index + 1,
  }));
