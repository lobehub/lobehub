import type { SearchSyncDrainResult } from '../../apps/server/src/services/searchSync';
import { summarizeSearchReindexError } from '../../packages/database/src/repositories/searchReindex';
import { parseElasticsearchSyncCliOptions } from './options';

type SearchSyncService = {
  drainOnce: () => Promise<SearchSyncDrainResult>;
  hasDeadLetters: () => Promise<boolean>;
};

type SearchSyncRuntime = {
  getSearchSyncService: () => SearchSyncService;
  verifyIncrementalSearchSyncReadiness: () => Promise<unknown>;
};

export interface ElasticsearchSyncRunSummary {
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

export interface RunElasticsearchSyncOptions {
  loadRuntime?: () => Promise<SearchSyncRuntime>;
  logStep?: (summary: ElasticsearchSyncRunSummary) => void;
  maxSteps: number;
}

const loadRuntime = () => import('../../apps/server/src/services/searchSync');

/** Runs a bounded drain so any cron or process supervisor can schedule it without a daemon. */
export const runElasticsearchSync = async ({
  loadRuntime: load = loadRuntime,
  logStep = () => undefined,
  maxSteps,
}: RunElasticsearchSyncOptions): Promise<ElasticsearchSyncRunSummary> => {
  const runtime = await load();
  await runtime.verifyIncrementalSearchSyncReadiness();
  const service = runtime.getSearchSyncService();
  if (await service.hasDeadLetters()) {
    throw new Error('Elasticsearch sync is blocked by existing dead-letter work');
  }

  const summary: ElasticsearchSyncRunSummary = {
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
      throw new Error('Elasticsearch sync created dead-letter work');
    }
    if (drained.failed > 0) {
      throw new Error('Elasticsearch sync left retryable failed work');
    }
    if (drained.claimed === 0 || !drained.hasMore) break;
  }

  if (await service.hasDeadLetters()) {
    throw new Error('Elasticsearch sync is blocked by dead-letter work');
  }

  return summary;
};

type Logger = (...arguments_: unknown[]) => void;

export interface RunElasticsearchSyncCliOptions {
  args?: readonly string[];
  loadRuntime?: () => Promise<SearchSyncRuntime>;
  logError?: Logger;
  logSuccess?: Logger;
}

export const runElasticsearchSyncCli = async ({
  args = process.argv.slice(2),
  loadRuntime: load,
  logError = console.error,
  logSuccess = console.log,
}: RunElasticsearchSyncCliOptions = {}): Promise<number> => {
  try {
    const options = parseElasticsearchSyncCliOptions(args);
    if (!options.yes) {
      throw new Error('Elasticsearch sync requires --yes after reviewing its documented effects');
    }

    const summary = await runElasticsearchSync({
      loadRuntime: load,
      logStep: (step) => logSuccess(JSON.stringify({ ...step, type: 'search_sync_step' })),
      maxSteps: options.maxSteps,
    });
    logSuccess(JSON.stringify({ ...summary, success: true, type: 'search_sync_completed' }));
    return 0;
  } catch (error) {
    logError('Elasticsearch sync failed:', summarizeSearchReindexError(error));
    return 1;
  }
};
