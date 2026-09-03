import { describe, expect, it } from 'vitest';

import { FTS_SEARCH_DOCUMENT_FIXTURES } from './__tests__/fixtures';
import { FTS_SEARCH_DOCUMENT_ENTITIES, parseFtsSearchDocumentSource } from './schema';

describe('search document schemas', () => {
  it.each(FTS_SEARCH_DOCUMENT_ENTITIES)('parses the fixed %s fixture', (entity) => {
    expect(parseFtsSearchDocumentSource(entity, FTS_SEARCH_DOCUMENT_FIXTURES[entity])).toEqual(
      FTS_SEARCH_DOCUMENT_FIXTURES[entity],
    );
  });

  it('rejects fields not declared by the canonical document schema', () => {
    expect(() =>
      parseFtsSearchDocumentSource('agents', {
        ...FTS_SEARCH_DOCUMENT_FIXTURES.agents,
        undeclared_field: 'must not reach Elasticsearch',
      }),
    ).toThrow();
  });

  it('accepts the shared soft-delete projection marker', () => {
    expect(
      parseFtsSearchDocumentSource('agents', {
        ...FTS_SEARCH_DOCUMENT_FIXTURES.agents,
        fts_search_sync_deleted: true,
      }),
    ).toMatchObject({ fts_search_sync_deleted: true });
  });
});
