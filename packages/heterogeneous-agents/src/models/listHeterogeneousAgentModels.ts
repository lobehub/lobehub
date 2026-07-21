import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import type {
  HeterogeneousAgentModel,
  HeterogeneousAgentModelCatalog,
  HeterogeneousAgentModelCatalogErrorCode,
  ListHeterogeneousAgentModelsParams,
} from '@lobechat/types';

import { resolveCliSpawnPlan } from '../spawn/cliSpawn';
import { resolveHeteroSpawnCommand } from '../spawn/resolveCliCommand';

const execFilePromise = promisify(execFile);
const MODEL_CATALOG_MAX_BUFFER = 256 * 1024;
const MODEL_CATALOG_TIMEOUT_MS = 15_000;
const OPENCODE_MODEL_ID_PATTERN = /^[A-Z0-9][\w.-]*\/[A-Z0-9@][\w./:@+-]*$/i;

export const parseOpenCodeModelCatalog = (stdout: string): HeterogeneousAgentModel[] => {
  const seen = new Set<string>();
  const models: HeterogeneousAgentModel[] = [];

  for (const rawLine of stdout.split(/\r?\n/)) {
    const id = rawLine.trim();
    const separatorIndex = id.indexOf('/');
    if (!OPENCODE_MODEL_ID_PATTERN.test(id) || separatorIndex <= 0 || seen.has(id)) continue;

    seen.add(id);
    models.push({
      id,
      modelId: id.slice(separatorIndex + 1),
      providerId: id.slice(0, separatorIndex),
    });
  }

  return models;
};

const getErrorRecord = (error: unknown) =>
  error as {
    code?: string;
    killed?: boolean;
    message?: string;
    signal?: string;
    stderr?: Buffer | string;
  };

const classifyCatalogError = (error: unknown): HeterogeneousAgentModelCatalogErrorCode => {
  const { code, killed, signal } = getErrorRecord(error);
  if (code === 'ENOENT') return 'cli_not_found';
  if (code === 'ETIMEDOUT' || killed || signal === 'SIGTERM') return 'timeout';
  return 'command_failed';
};

const getCatalogErrorMessage = (code: HeterogeneousAgentModelCatalogErrorCode): string => {
  if (code === 'cli_not_found') return 'OpenCode CLI was not found';
  if (code === 'timeout') return 'OpenCode model discovery timed out';

  return 'OpenCode model discovery failed';
};

/**
 * Query the model catalog from the same host that will execute the agent.
 *
 * Callers own construction of the full child environment so Desktop can apply
 * the same inherited-env stripping/proxy rules as a real session while `lh
 * connect` can use its daemon environment. Resolver-discovered PATH is merged
 * underneath explicit caller values.
 */
export const listHeterogeneousAgentModels = async (
  params: ListHeterogeneousAgentModelsParams,
): Promise<HeterogeneousAgentModelCatalog> => {
  const updatedAt = Date.now();
  const resolved = await resolveHeteroSpawnCommand('opencode', params.command);
  const args = ['models'];
  const spawnPlan = await resolveCliSpawnPlan(resolved.command, args);
  const callerEnv = params.env ?? process.env;
  const mergedPath = [
    ...new Set(
      [callerEnv.PATH, resolved.pathEnv].filter(Boolean).join(path.delimiter).split(path.delimiter),
    ),
  ]
    .filter(Boolean)
    .join(path.delimiter);
  const env = {
    ...callerEnv,
    ...(mergedPath ? { PATH: mergedPath } : {}),
  };

  try {
    const { stdout } = await execFilePromise(spawnPlan.command, spawnPlan.args, {
      cwd: params.cwd,
      encoding: 'utf8',
      env: env as NodeJS.ProcessEnv,
      maxBuffer: MODEL_CATALOG_MAX_BUFFER,
      timeout: MODEL_CATALOG_TIMEOUT_MS,
      windowsHide: true,
    });

    return {
      models: parseOpenCodeModelCatalog(String(stdout)),
      status: 'success',
      updatedAt,
    };
  } catch (error) {
    const code = classifyCatalogError(error);
    return {
      error: { code, message: getCatalogErrorMessage(code) },
      status: 'error',
      updatedAt,
    };
  }
};
