import { describe, expect, it } from 'vitest';

import {
  buildFtsSearchIndexMeta,
  findFtsSearchIndexSchemaMismatch,
  getFtsSearchIndexSchemaFingerprint,
  sha256Json,
  stableStringify,
} from './fingerprint';
import { FTS_SEARCH_INDEX_ANALYSIS, FTS_SEARCH_INDEX_DEFINITIONS } from './mappings';

describe('stableStringify', () => {
  it('orders object keys recursively so equivalent inputs hash identically', () => {
    expect(stableStringify({ b: [{ d: 1, c: 2 }], a: null })).toBe(
      '{"a":null,"b":[{"c":2,"d":1}]}',
    );
    expect(sha256Json({ a: 1, b: 2 })).toBe(sha256Json({ b: 2, a: 1 }));
  });
});

describe('getFtsSearchIndexSchemaFingerprint', () => {
  it('covers both the entity mapping and the shared analysis', () => {
    expect(getFtsSearchIndexSchemaFingerprint('files')).toBe(
      sha256Json({
        analysis: FTS_SEARCH_INDEX_ANALYSIS,
        mappings: FTS_SEARCH_INDEX_DEFINITIONS.files.mappings,
      }),
    );
  });
});

describe('buildFtsSearchIndexMeta', () => {
  it('stamps the declared generation and fingerprint next to the reindex run', () => {
    expect(buildFtsSearchIndexMeta('agents', 'run-1')).toEqual({
      reindex_run_id: 'run-1',
      schema_fingerprint: getFtsSearchIndexSchemaFingerprint('agents'),
      schema_version: FTS_SEARCH_INDEX_DEFINITIONS.agents.schemaVersion,
    });
  });
});

describe('findFtsSearchIndexSchemaMismatch', () => {
  const declared = buildFtsSearchIndexMeta('topics', 'run-1');

  it('accepts an index that implements the declared generation', () => {
    expect(findFtsSearchIndexSchemaMismatch('topics', declared)).toBeUndefined();
  });

  it('accepts a legacy index without a fingerprint on version alone', () => {
    expect(
      findFtsSearchIndexSchemaMismatch('topics', { schema_version: declared.schema_version }),
    ).toBeUndefined();
  });

  it('reports a version mismatch before inspecting the fingerprint', () => {
    expect(
      findFtsSearchIndexSchemaMismatch('topics', {
        schema_fingerprint: 'stale',
        schema_version: declared.schema_version + 1,
      }),
    ).toEqual({
      actual: declared.schema_version + 1,
      expected: declared.schema_version,
      kind: 'version',
    });
  });

  it('reports drift when the same version carries a different fingerprint', () => {
    expect(
      findFtsSearchIndexSchemaMismatch('topics', {
        schema_fingerprint: 'stale',
        schema_version: declared.schema_version,
      }),
    ).toEqual({ actual: 'stale', expected: declared.schema_fingerprint, kind: 'fingerprint' });
  });
});
