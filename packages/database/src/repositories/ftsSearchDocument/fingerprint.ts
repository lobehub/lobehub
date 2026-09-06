import { createHash } from 'node:crypto';

import {
  FTS_SEARCH_INDEX_ANALYSIS,
  FTS_SEARCH_INDEX_DEFINITIONS,
  getFtsSearchIndexSchemaVersion,
} from './mappings';
import type { FtsSearchDocumentEntity } from './schema';

/** Deterministic JSON with sorted object keys so semantically equal inputs hash identically. */
export const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  return `{${Object.entries(value)
    .sort(([leftKey], [rightKey]) => (leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(',')}}`;
};

export const sha256Json = (value: unknown): string =>
  createHash('sha256').update(stableStringify(value)).digest('hex');

/**
 * Content hash of everything that shapes a physical index: the entity mapping plus the shared
 * analysis settings. It is stamped into `_meta.schema_fingerprint` when an index is created so the
 * runtime can detect drift between the declared target and the live index without diffing
 * Elasticsearch's normalized mapping response.
 */
export const getFtsSearchIndexSchemaFingerprint = (entity: FtsSearchDocumentEntity): string =>
  sha256Json({
    analysis: FTS_SEARCH_INDEX_ANALYSIS,
    mappings: FTS_SEARCH_INDEX_DEFINITIONS[entity].mappings,
  });

/**
 * Application metadata stored on every physical index. Elasticsearch never reads `_meta`; it is the
 * durable record of which declared generation an index implements and which reindex run built it.
 */
export interface FtsSearchIndexMeta {
  reindex_run_id: string;
  /**
   * Absent on indexes created before fingerprints existed. Readers treat a missing fingerprint as
   * legacy and only reject a present fingerprint that differs from the declared one.
   */
  schema_fingerprint?: string;
  schema_version: number;
}

export const buildFtsSearchIndexMeta = (
  entity: FtsSearchDocumentEntity,
  reindexRunId: string,
): Required<FtsSearchIndexMeta> => ({
  reindex_run_id: reindexRunId,
  schema_fingerprint: getFtsSearchIndexSchemaFingerprint(entity),
  schema_version: getFtsSearchIndexSchemaVersion(entity),
});

export type FtsSearchIndexSchemaMismatch =
  | { actual: number; expected: number; kind: 'version' }
  | { actual: string; expected: string; kind: 'fingerprint' };

/**
 * Compares a live index's `_meta` against the declared generation for `entity`. Returns the first
 * mismatch, or `undefined` when the index implements the declared mapping (legacy indexes without a
 * fingerprint pass on version alone).
 */
export const findFtsSearchIndexSchemaMismatch = (
  entity: FtsSearchDocumentEntity,
  meta: Pick<FtsSearchIndexMeta, 'schema_fingerprint' | 'schema_version'>,
): FtsSearchIndexSchemaMismatch | undefined => {
  const expectedVersion = getFtsSearchIndexSchemaVersion(entity);
  if (meta.schema_version !== expectedVersion) {
    return { actual: meta.schema_version, expected: expectedVersion, kind: 'version' };
  }

  const expectedFingerprint = getFtsSearchIndexSchemaFingerprint(entity);
  if (meta.schema_fingerprint !== undefined && meta.schema_fingerprint !== expectedFingerprint) {
    return { actual: meta.schema_fingerprint, expected: expectedFingerprint, kind: 'fingerprint' };
  }
};
