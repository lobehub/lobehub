import { describe, expect, it } from 'vitest';

import { FTS_SEARCH_BACKEND_ENTITIES } from '../types';
import { isElasticsearchFtsSearchEntity } from './query-fields';

describe('Elasticsearch query field coverage', () => {
  it('covers every full-text search backend entity', () => {
    expect(
      FTS_SEARCH_BACKEND_ENTITIES.filter((entity) => !isElasticsearchFtsSearchEntity(entity)),
    ).toEqual([]);
  });
});
