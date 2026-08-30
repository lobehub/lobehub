// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getSearchConfig } from '../search';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getSearchConfig', () => {
  it('exposes optional Elasticsearch connection and index configuration', () => {
    vi.stubEnv('ES_API_KEY', 'test-api-key');
    vi.stubEnv('ES_INCREMENTAL_SYNC_ENABLED', 'true');
    vi.stubEnv('ES_INDEX_NAMESPACE', 'lobehub-dev');
    vi.stubEnv('ES_URL', 'https://search.example.com');

    expect(getSearchConfig()).toMatchObject({
      ES_API_KEY: 'test-api-key',
      ES_INCREMENTAL_SYNC_ENABLED: 'true',
      ES_INDEX_NAMESPACE: 'lobehub-dev',
      ES_URL: 'https://search.example.com',
    });
  });

  it('keeps Elasticsearch configuration optional', () => {
    vi.stubEnv('ES_API_KEY', undefined);
    vi.stubEnv('ES_INCREMENTAL_SYNC_ENABLED', undefined);
    vi.stubEnv('ES_INDEX_NAMESPACE', undefined);
    vi.stubEnv('ES_URL', undefined);

    expect(getSearchConfig()).toMatchObject({
      ES_API_KEY: undefined,
      ES_INCREMENTAL_SYNC_ENABLED: undefined,
      ES_INDEX_NAMESPACE: undefined,
      ES_URL: undefined,
    });
  });
});
