import schemaSnapshots from './schemaSnapshots.json';

export interface FtsSearchIndexSchemaSnapshot {
  fingerprint: string;
  schemaVersion: number;
}

/**
 * Approved physical index schemas, keyed by the source migration batch that introduced them.
 * Published entries are immutable; append a batch when a mapping or shared analysis changes.
 */
export const FTS_SEARCH_INDEX_SCHEMA_SNAPSHOTS: Record<
  string,
  Record<string, FtsSearchIndexSchemaSnapshot>
> = schemaSnapshots;
