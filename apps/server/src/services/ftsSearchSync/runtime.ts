import {
  FTS_SEARCH_DOCUMENT_ENTITIES,
  FtsSearchDocumentBuilder,
  getFtsSearchIndexAlias,
} from '@/database/repositories/ftsSearchDocument';
import { ftsSearchSyncOutboxRepository } from '@/database/repositories/ftsSearchSyncOutbox/server';
import { serverDB } from '@/database/server';
import { ftsSearchEnv } from '@/envs/ftsSearch';

import { loadElasticsearchFtsSearchConfig } from '../ftsSearch';
import { ElasticsearchFtsSearchHttpClient } from '../ftsSearch/elasticsearch';
import { FtsSearchSyncService } from './service';

let cachedService: FtsSearchSyncService | undefined;

export const isFtsSearchSyncEnabled = () =>
  ftsSearchEnv.FTS_SEARCH_SYNC_ENABLED === 'true' &&
  loadElasticsearchFtsSearchConfig() !== undefined;

/** Fail closed unless every entity has a writable alias whose mapping supports soft tombstones. */
export const verifyFtsSearchSyncReadiness = async () => {
  const config = loadElasticsearchFtsSearchConfig();
  if (ftsSearchEnv.FTS_SEARCH_SYNC_ENABLED !== 'true' || !config) {
    throw new Error('Elasticsearch full-text search sync is not enabled and configured');
  }

  await ftsSearchSyncOutboxRepository.assertCaptureInfrastructure();
  const client = new ElasticsearchFtsSearchHttpClient({ ...config, requestTimeoutMs: 10_000 });
  await client.assertFtsSearchSyncAliases(
    FTS_SEARCH_DOCUMENT_ENTITIES.map((entity) =>
      getFtsSearchIndexAlias(config.indexNamespace, entity),
    ),
  );
  return { ready: true as const };
};

export const getFtsSearchSyncService = (): FtsSearchSyncService => {
  if (cachedService) return cachedService;
  const config = loadElasticsearchFtsSearchConfig();
  if (!config) throw new Error('Elasticsearch full-text search sync is not configured');

  cachedService = new FtsSearchSyncService(
    new FtsSearchDocumentBuilder(serverDB),
    ftsSearchSyncOutboxRepository,
    new ElasticsearchFtsSearchHttpClient({ ...config, requestTimeoutMs: 20_000 }),
    config.indexNamespace,
  );
  return cachedService;
};
