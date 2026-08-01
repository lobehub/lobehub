import { describe, expect, it } from 'vitest';

import { isPgSearchUnavailableError, migrationUsesPgSearchOrBm25 } from './bm25Compatibility';

describe('migrationUsesPgSearchOrBm25', () => {
  it('detects pg_search extension migrations', () => {
    expect(migrationUsesPgSearchOrBm25(['CREATE EXTENSION IF NOT EXISTS pg_search;'])).toBe(true);
  });

  it('detects bm25 index migrations', () => {
    expect(
      migrationUsesPgSearchOrBm25(['CREATE INDEX agents_bm25_idx ON agents USING bm25 (id)']),
    ).toBe(true);
  });

  it('ignores unrelated SQL', () => {
    expect(migrationUsesPgSearchOrBm25(['CREATE TABLE agents (id text)'])).toBe(false);
  });
});

describe('isPgSearchUnavailableError', () => {
  it('matches Neon deprecated extension errors', () => {
    expect(
      isPgSearchUnavailableError(
        Object.assign(new Error('Failed query'), {
          cause: new Error('extension "pg_search" is deprecated and no longer allowed'),
        }),
      ),
    ).toBe(true);
  });

  it('rejects unrelated errors', () => {
    expect(isPgSearchUnavailableError(new Error('relation users does not exist'))).toBe(false);
  });
});
