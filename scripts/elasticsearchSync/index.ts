import type { FtsSearchSyncDrainResult } from '../../apps/server/src/services/ftsSearchSync';
import { summarizeFtsSearchReindexError } from '../../packages/database/src/repositories/ftsSearchReindex';
import { parseElasticsearchFtsSearchSyncCliOptions } from './options';

type FtsSearchSyncService = {
  drainOnce: () => Promise<FtsSearchSyncDrainResult>;
  hasDeadLetters: () => Promise<boolean>;
};

type FtsSearchSyncRuntime = {
  getFtsSearchSyncService: () => FtsSearchSyncService;
  verifyFtsSearchSyncReadiness: () => Promise<unknown>;
};

export interface ElasticsearchFtsSearchSyncRunSummary {
  acknowledged: number;
  bulkBytes: number;
  bulkItems: number;
  bulkRequests: number;
  claimed: number;
  failed: number;
  hasMore: boolean;
  released: number;
  steps: number;
}

export interface RunElasticsearchFtsSearchSyncOptions {
  loadRuntime?: () => Promise<FtsSearchSyncRuntime>;
  logStep?: (summary: ElasticsearchFtsSearchSyncRunSummary) => void;
  maxSteps: number;
}

const loadRuntime = () => import('../../apps/server/src/services/ftsSearchSync');

/** Runs a bounded drain so any cron or process supervisor can schedule it without a daemon. */
export const runElasticsearchFtsSearchSync = async ({
  loadRuntime: load = loadRuntime,
  logStep = () => undefined,
  maxSteps,
}: RunElasticsearchFtsSearchSyncOptions): Promise<ElasticsearchFtsSearchSyncRunSummary> => {
  const runtime = await load();
  await runtime.verifyFtsSearchSyncReadiness();
  const service = runtime.getFtsSearchSyncService();
  if (await service.hasDeadLetters()) {
    throw new Error('Elasticsearch full-text search sync is blocked by existing dead-letter work');
  }

  const summary: ElasticsearchFtsSearchSyncRunSummary = {
    acknowledged: 0,
    bulkBytes: 0,
    bulkItems: 0,
    bulkRequests: 0,
    claimed: 0,
    failed: 0,
    hasMore: false,
    released: 0,
    steps: 0,
  };

  for (let step = 0; step < maxSteps; step += 1) {
    const drained = await service.drainOnce();
    summary.acknowledged += drained.acknowledged;
    summary.bulkBytes += drained.bulkBytes;
    summary.bulkItems += drained.bulkItems;
    summary.bulkRequests += drained.bulkRequests;
    summary.claimed += drained.claimed;
    summary.failed += drained.failed;
    summary.hasMore = drained.hasMore;
    summary.released += drained.released;
    summary.steps += 1;
    logStep({ ...summary });

    if (drained.dead > 0) {
      throw new Error('Elasticsearch full-text search sync created dead-letter work');
    }
    if (drained.failed > 0) {
      throw new Error('Elasticsearch full-text search sync left retryable failed work');
    }
    if (drained.claimed === 0 || !drained.hasMore) break;
  }

  if (await service.hasDeadLetters()) {
    throw new Error('Elasticsearch full-text search sync is blocked by dead-letter work');
  }

  return summary;
};

type Logger = (...arguments_: unknown[]) => void;

export interface RunElasticsearchFtsSearchSyncCliOptions {
  args?: readonly string[];
  loadRuntime?: () => Promise<FtsSearchSyncRuntime>;
  logError?: Logger;
  logSuccess?: Logger;
}

export const runElasticsearchFtsSearchSyncCli = async ({
  args = process.argv.slice(2),
  loadRuntime: load,
  logError = console.error,
  logSuccess = console.log,
}: RunElasticsearchFtsSearchSyncCliOptions = {}): Promise<number> => {
  try {
    const options = parseElasticsearchFtsSearchSyncCliOptions(args);
    if (!options.yes) {
      throw new Error(
        'Elasticsearch full-text search sync requires --yes after reviewing its documented effects',
      );
    }

    const summary = await runElasticsearchFtsSearchSync({
      loadRuntime: load,
      logStep: (step) => logSuccess(JSON.stringify({ ...step, type: 'fts_search_sync_step' })),
      maxSteps: options.maxSteps,
    });
    logSuccess(JSON.stringify({ ...summary, success: true, type: 'fts_search_sync_completed' }));
    return 0;
  } catch (error) {
    logError('Elasticsearch full-text search sync failed:', summarizeFtsSearchReindexError(error));
    return 1;
  }
};
