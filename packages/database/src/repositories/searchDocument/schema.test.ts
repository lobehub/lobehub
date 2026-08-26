import { describe, expect, it } from 'vitest';

import { SEARCH_DOCUMENT_FIXTURES } from './__tests__/fixtures';
import { parseSearchDocumentSource, SEARCH_DOCUMENT_ENTITIES } from './schema';

describe('search document schemas', () => {
  it.each(SEARCH_DOCUMENT_ENTITIES)('parses the fixed %s fixture', (entity) => {
    expect(parseSearchDocumentSource(entity, SEARCH_DOCUMENT_FIXTURES[entity])).toEqual(
      SEARCH_DOCUMENT_FIXTURES[entity],
    );
  });

  it('rejects fields not declared by the canonical document schema', () => {
    expect(() =>
      parseSearchDocumentSource('agents', {
        ...SEARCH_DOCUMENT_FIXTURES.agents,
        undeclared_field: 'must not reach Elasticsearch',
      }),
    ).toThrow();
  });
});
