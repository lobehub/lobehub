import { searchEnv } from '@lobechat/env/search';

import {
  getSearchIndexAlias,
  SEARCH_DOCUMENT_ENTITIES,
  SearchDocumentBuilder,
} from '@/database/repositories/searchDocument';
import { searchSyncOutboxRepository } from '@/database/repositories/searchSyncOutbox/server';
import { serverDB } from '@/database/server';

import { loadSearchElasticsearchConfig } from '../searchBackend';
import { ElasticsearchHttpClient } from '../searchBackend/elasticsearch';
import { SearchSyncService } from './service';

let cachedService: SearchSyncService | undefined;

export const isIncrementalSearchSyncEnabled = () =>
  searchEnv.ES_INCREMENTAL_SYNC_ENABLED === 'true' && loadSearchElasticsearchConfig() !== undefined;

/** Fail closed unless every entity has a writable alias whose mapping supports soft tombstones. */
export const verifyIncrementalSearchSyncReadiness = async () => {
  const config = loadSearchElasticsearchConfig();
  if (searchEnv.ES_INCREMENTAL_SYNC_ENABLED !== 'true' || !config) {
    throw new Error('Elasticsearch incremental sync is not enabled and configured');
  }

  await searchSyncOutboxRepository.assertCaptureInfrastructure();
  const client = new ElasticsearchHttpClient({ ...config, requestTimeoutMs: 10_000 });
  await client.assertSearchSyncAliases(
    SEARCH_DOCUMENT_ENTITIES.map((entity) => getSearchIndexAlias(config.indexNamespace, entity)),
  );
  return { ready: true as const };
};

export const getSearchSyncService = (): SearchSyncService => {
  if (cachedService) return cachedService;
  const config = loadSearchElasticsearchConfig();
  if (!config) throw new Error('Elasticsearch incremental sync is not configured');

  cachedService = new SearchSyncService(
    new SearchDocumentBuilder(serverDB),
    searchSyncOutboxRepository,
    new ElasticsearchHttpClient({ ...config, requestTimeoutMs: 20_000 }),
    config.indexNamespace,
  );
  return cachedService;
};
