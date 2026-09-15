// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getElasticsearchFtsSearchConfig, getFtsSearchConfig } from '../ftsSearch';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getFtsSearchConfig', () => {
  it('exposes optional Elasticsearch connection and index configuration', () => {
    vi.stubEnv('ES_API_KEY', 'test-api-key');
    vi.stubEnv('FTS_SEARCH_SYNC_ENABLED', 'true');
    vi.stubEnv('ES_INDEX_NAMESPACE', 'lobehub-dev');
    vi.stubEnv('ES_URL', 'https://search.example.com');
    vi.stubEnv('FTS_SEARCH_PROVIDER', 'elasticsearch');

    expect(getFtsSearchConfig()).toMatchObject({
      ES_API_KEY: 'test-api-key',
      FTS_SEARCH_SYNC_ENABLED: 'true',
      ES_INDEX_NAMESPACE: 'lobehub-dev',
      ES_URL: 'https://search.example.com',
      FTS_SEARCH_PROVIDER: 'elasticsearch',
    });
  });

  it('keeps Elasticsearch configuration optional', () => {
    vi.stubEnv('ES_API_KEY', undefined);
    vi.stubEnv('FTS_SEARCH_SYNC_ENABLED', undefined);
    vi.stubEnv('ES_INDEX_NAMESPACE', undefined);
    vi.stubEnv('ES_URL', undefined);
    vi.stubEnv('FTS_SEARCH_PROVIDER', undefined);

    expect(getFtsSearchConfig()).toMatchObject({
      ES_API_KEY: undefined,
      FTS_SEARCH_SYNC_ENABLED: undefined,
      ES_INDEX_NAMESPACE: undefined,
      ES_URL: undefined,
      FTS_SEARCH_PROVIDER: 'pg_search',
    });
  });

  it('rejects unsupported search backends', () => {
    vi.stubEnv('FTS_SEARCH_PROVIDER', 'opensearch');

    expect(() => getFtsSearchConfig()).toThrow();
  });
});

describe('getElasticsearchFtsSearchConfig', () => {
  it('does not expose the deployment provider selector', () => {
    vi.stubEnv('ES_API_KEY', 'test-api-key');
    vi.stubEnv('ES_INDEX_NAMESPACE', 'lobehub-dev');
    vi.stubEnv('ES_URL', 'https://search.example.com');
    vi.stubEnv('FTS_SEARCH_PROVIDER', 'pg_search');

    expect(getElasticsearchFtsSearchConfig()).toEqual({
      ES_API_KEY: 'test-api-key',
      FTS_SEARCH_SYNC_ENABLED: undefined,
      ES_INDEX_NAMESPACE: 'lobehub-dev',
      ES_URL: 'https://search.example.com',
    });
  });
});
