import { describe, expect, it } from 'vitest';

import {
  assertSearchReindexElasticsearchHostname,
  resolveSearchReindexElasticsearchEnvironment,
} from '../options';

describe('resolveSearchReindexElasticsearchEnvironment', () => {
  it('uses the canonical pair by default', () => {
    expect(resolveSearchReindexElasticsearchEnvironment([])).toEqual({
      apiKeyEnvironmentName: 'ES_API_KEY',
      urlEnvironmentName: 'ES_URL',
    });
  });

  it('selects an explicit endpoint and credential pair without reading their values', () => {
    expect(
      resolveSearchReindexElasticsearchEnvironment([
        '--elasticsearch-url-env=DEV_SEARCH_ES_URL',
        '--elasticsearch-api-key-env=DEV_SEARCH_ES_API_KEY',
        '--expected-elasticsearch-host-prefix=dev-search-',
      ]),
    ).toEqual({
      apiKeyEnvironmentName: 'DEV_SEARCH_ES_API_KEY',
      expectedHostPrefix: 'dev-search-',
      urlEnvironmentName: 'DEV_SEARCH_ES_URL',
    });
  });

  it('refuses a partial pair or a non-environment-variable name', () => {
    expect(() =>
      resolveSearchReindexElasticsearchEnvironment(['--elasticsearch-url-env=DEV_SEARCH_ES_URL']),
    ).toThrow('must be provided together');
    expect(() =>
      resolveSearchReindexElasticsearchEnvironment([
        '--elasticsearch-url-env=../../secret',
        '--elasticsearch-api-key-env=ES_API_KEY',
      ]),
    ).toThrow('must name an uppercase environment variable');
  });

  it('refuses a hostname outside the explicitly required target prefix', () => {
    expect(() =>
      assertSearchReindexElasticsearchHostname('production-search.example.com', 'dev-search-'),
    ).toThrow('does not match required prefix');
    expect(() =>
      assertSearchReindexElasticsearchHostname('dev-search-abc.example.com', 'dev-search-'),
    ).not.toThrow();
  });
});
