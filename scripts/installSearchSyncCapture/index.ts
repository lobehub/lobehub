import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';

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

export type SearchSyncCaptureRepository = {
  installCaptureInfrastructure: () => Promise<void>;
};

type LoadRepository = () => Promise<SearchSyncCaptureRepository>;
type RunWithLockRetry = (operation: () => Promise<void>) => Promise<void>;
type Logger = (...arguments_: unknown[]) => void;

export type InstallSearchSyncCaptureOptions = {
  env?: NodeJS.ProcessEnv;
  loadRepository?: LoadRepository;
  runWithLockRetry?: RunWithLockRetry;
};

export type SearchSyncCaptureCliOptions = InstallSearchSyncCaptureOptions & {
  logError?: Logger;
  logSuccess?: Logger;
};

const loadRepository: LoadRepository = async () => {
  // Keep database initialization out of the module graph until the required environment is set.
  const { searchSyncOutboxRepository } =
    await import('../../packages/database/src/repositories/searchSyncOutbox/server');

  return searchSyncOutboxRepository;
};

export const installSearchSyncCapture = async ({
  env: environment = process.env,
  loadRepository: load = loadRepository,
  runWithLockRetry = defaultRunWithLockRetry,
}: InstallSearchSyncCaptureOptions = {}) => {
  if (!environment.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const repository = await load();

  await runWithLockRetry(() => repository.installCaptureInfrastructure());
};

export const runSearchSyncCaptureCli = async ({
  logError = console.error,
  logSuccess = console.log,
  ...options
}: SearchSyncCaptureCliOptions = {}) => {
  try {
    await installSearchSyncCapture(options);
    logSuccess('✅ search sync capture infrastructure installed');
    return 0;
  } catch (error) {
    logError('❌ Search sync capture installation failed:', error);
    return 1;
  }
};

const isDirectExecution = () => {
  const entrypoint = process.argv[1];

  return entrypoint !== undefined && path.resolve(entrypoint) === fileURLToPath(import.meta.url);
};

if (isDirectExecution()) {
  void runSearchSyncCaptureCli().then((exitCode) => {
    process.exit(exitCode);
  });
}
