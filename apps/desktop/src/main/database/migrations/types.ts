export interface LocalDatabaseMigration {
  /** Stable human-readable identifier recorded in the database. */
  name: string;
  /** Ordered SQL statements applied atomically for this version. */
  statements: readonly string[];
  /** Immutable, monotonically increasing schema version. */
  version: number;
}
