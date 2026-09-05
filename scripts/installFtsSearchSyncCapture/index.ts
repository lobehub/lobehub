import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';

import { summarizeFtsSearchReindexError } from '../elasticsearchReindex/runtime/auditLogger';
import { runWithLockRetry as defaultRunWithLockRetry } from '../migrateServerDB/retry';

// Load environment variables in priority order:
// 1. .env (lowest priority)
// 2. .env.[env] (medium priority, overrides .env)
// 3. .env.[env].local (highest priority, overrides previous)
// Use dotenv-expand to support ${var} variable expansion
const env = process.env.NODE_ENV || 'development';
dotenvExpand.expand(dotenv.config()); // Load .env
dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${env}` })); // Load .env.[env] and override
dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${env}.local` })); // Load .env.[env].local and override

export type FtsSearchSyncCaptureRepository = {
  installCaptureInfrastructure: () => Promise<void>;
};

type LoadRepository = () => Promise<FtsSearchSyncCaptureRepository>;
type RunWithLockRetry = (operation: () => Promise<void>) => Promise<void>;
type Logger = (...arguments_: unknown[]) => void;

interface FtsSearchSyncCaptureEnvironment {
  DATABASE_URL?: string;
  FTS_SEARCH_PROVIDER?: string;
}

const ELASTICSEARCH_PROVIDER = 'elasticsearch';

/**
 * The outbox capture only feeds the Elasticsearch sync worker. Deployments that
 * explicitly select another provider (`pg_search`, `pg_like`) skip it so the
 * migrate chain succeeds without Elasticsearch-specific database objects.
 *
 * An unset provider still installs capture: the only distribution wiring this
 * script into its migrate chain defaults to Elasticsearch.
 */
export const shouldInstallFtsSearchSyncCapture = (
  environment: FtsSearchSyncCaptureEnvironment,
): boolean =>
  !environment.FTS_SEARCH_PROVIDER || environment.FTS_SEARCH_PROVIDER === ELASTICSEARCH_PROVIDER;

export type InstallFtsSearchSyncCaptureOptions = {
  env?: FtsSearchSyncCaptureEnvironment;
  loadRepository?: LoadRepository;
  runWithLockRetry?: RunWithLockRetry;
};

export type FtsSearchSyncCaptureCliOptions = InstallFtsSearchSyncCaptureOptions & {
  logError?: Logger;
  logSuccess?: Logger;
};

const loadRepository: LoadRepository = async () => {
  // Keep database initialization out of the module graph until the required environment is set.
  const { ftsSearchSyncOutboxRepository } =
    await import('../../packages/database/src/repositories/ftsSearchSyncOutbox/server');

  return ftsSearchSyncOutboxRepository;
};

const defaultEnvironment = (): FtsSearchSyncCaptureEnvironment => ({
  DATABASE_URL: process.env.DATABASE_URL,
  FTS_SEARCH_PROVIDER: process.env.FTS_SEARCH_PROVIDER,
});

/** Resolves to `false` when capture installation was skipped for the selected provider. */
export const installFtsSearchSyncCapture = async ({
  env: environment = defaultEnvironment(),
  loadRepository: load = loadRepository,
  runWithLockRetry = defaultRunWithLockRetry,
}: InstallFtsSearchSyncCaptureOptions = {}): Promise<boolean> => {
  if (!shouldInstallFtsSearchSyncCapture(environment)) return false;
  if (!environment.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const repository = await load();

  await runWithLockRetry(() => repository.installCaptureInfrastructure());

  return true;
};

export const runFtsSearchSyncCaptureCli = async ({
  logError = console.error,
  logSuccess = console.log,
  ...options
}: FtsSearchSyncCaptureCliOptions = {}) => {
  try {
    const installed = await installFtsSearchSyncCapture(options);
    logSuccess(
      installed
        ? '✅ full-text search sync capture infrastructure installed'
        : `⏭️ full-text search sync capture skipped: FTS_SEARCH_PROVIDER=${options.env?.FTS_SEARCH_PROVIDER ?? process.env.FTS_SEARCH_PROVIDER} does not use Elasticsearch`,
    );
    return 0;
  } catch (error) {
    logError(
      '❌ Full-text search sync capture installation failed:',
      summarizeFtsSearchReindexError(error),
    );
    return 1;
  }
};

const isDirectExecution = () => {
  const entrypoint = process.argv[1];

  return entrypoint !== undefined && path.resolve(entrypoint) === fileURLToPath(import.meta.url);
};

if (isDirectExecution()) {
  void runFtsSearchSyncCaptureCli().then((exitCode) => {
    process.exit(exitCode);
  });
}
