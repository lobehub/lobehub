import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import type {
  HeterogeneousAgentModel,
  HeterogeneousAgentModelCatalog,
  HeterogeneousAgentModelCatalogErrorCode,
  ListHeterogeneousAgentModelsParams,
} from '@lobechat/types';

import { getHeterogeneousTypeLabel } from '../labels';
import { resolveCliSpawnPlan } from '../spawn/cliSpawn';
import { listDroidAcpModels } from '../spawn/droidAcpSession';
import { resolveHeteroSpawnCommand } from '../spawn/resolveCliCommand';
import { listTraeAcpModels } from '../spawn/traeAcpSession';

const execFilePromise = promisify(execFile);
const MODEL_CATALOG_MAX_BUFFER = 256 * 1024;
const MODEL_CATALOG_TIMEOUT_MS = 15_000;
const CODEBUDDY_MODEL_OPTION = '--model <model>';
const CODEBUDDY_SUPPORTED_MODELS_LABEL = 'Currently supported:';
const CURSOR_MODEL_ANNOTATIONS = [' (current)', ' (default)'] as const;
const CURSOR_MODEL_ID_PATTERN = /^[A-Z0-9][\w./:@+-]*$/i;
const GROK_MODEL_ID_PATTERN = /^[A-Z0-9][\w./:@+-]*$/i;
const OPENCODE_MODEL_ID_PATTERN = /^[A-Z0-9][\w.-]*\/[A-Z0-9@][\w./:@+-]*$/i;
const PI_MODEL_ROW_PATTERN = /^(\S+)\s{2,}(\S+)\s{2,}\S+\s{2,}\S+\s{2,}(?:yes|no)\s{2,}(?:yes|no)$/;
const QODER_CUSTOM_MODEL_ROW_PATTERN = /^(.+?) \(([^()\s]+)\)$/;

const parseCodeBuddyModelCatalogResult = (
  output: string,
): HeterogeneousAgentModel[] | undefined => {
  const modelOptionIndex = output.indexOf(CODEBUDDY_MODEL_OPTION);
  if (modelOptionIndex < 0) return;

  const labelStart = output.indexOf(
    CODEBUDDY_SUPPORTED_MODELS_LABEL,
    modelOptionIndex + CODEBUDDY_MODEL_OPTION.length,
  );
  if (labelStart < 0) return;

  const labelEnd = labelStart + CODEBUDDY_SUPPORTED_MODELS_LABEL.length;
  const modelsStart = output.indexOf('(', labelEnd);
  if (modelsStart < 0 || output.slice(labelEnd, modelsStart).trim()) return;

  const modelsEnd = output.indexOf(')', modelsStart + 1);
  if (modelsEnd < 0) return;

  const supportedModels = output.slice(modelsStart + 1, modelsEnd);
  const modelIds = supportedModels.split(',').map((model) => model.trim());
  if (modelIds.some((id) => !id)) return;

  return [...new Set(modelIds)]
    .filter((id) => id !== 'default-model')
    .map((id) => ({ id, modelId: id, providerId: 'codebuddy' }));
};

/** Parse the model IDs accepted by CodeBuddy's native `--model` option. */
export const parseCodeBuddyModelCatalog = (output: string): HeterogeneousAgentModel[] =>
  parseCodeBuddyModelCatalogResult(output) ?? [];

/** Parse the `model-slug - Display Label` rows emitted by Cursor Agent. */
export const parseCursorModelCatalog = (stdout: string): HeterogeneousAgentModel[] => {
  const seen = new Set<string>();
  const models: HeterogeneousAgentModel[] = [];

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    const separatorIndex = line.indexOf(' - ');
    if (separatorIndex <= 0) continue;

    let id = line.slice(0, separatorIndex).trim();
    const annotation = CURSOR_MODEL_ANNOTATIONS.find((item) => id.endsWith(item));
    if (annotation) id = id.slice(0, -annotation.length);
    const label = line.slice(separatorIndex + 3).trim();
    if (!CURSOR_MODEL_ID_PATTERN.test(id) || !label || seen.has(id)) continue;

    seen.add(id);
    models.push({ id, label, modelId: id, providerId: 'cursor' });
  }

  return models;
};

/** Parse the model rows emitted by `grok models`. */
export const parseGrokBuildModelCatalog = (stdout: string): HeterogeneousAgentModel[] => {
  const seen = new Set<string>();
  const models: HeterogeneousAgentModel[] = [];

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine
      .trim()
      .replace(/^[*>•✓-]\s*/, '')
      .replace(/ \((?:current|default)\)$/, '');
    const separatorIndex = line.search(/\s{2}/);
    const id = (separatorIndex < 0 ? line : line.slice(0, separatorIndex)).trim();
    if (!GROK_MODEL_ID_PATTERN.test(id)) continue;

    if (id.toLowerCase() === 'model' || id.toLowerCase() === 'models' || seen.has(id)) continue;

    const label = (separatorIndex < 0 ? '' : line.slice(separatorIndex).trim())
      .replaceAll(' (current)', '')
      .replaceAll(' (default)', '')
      .trim();
    seen.add(id);
    models.push({
      id,
      ...(label ? { label } : {}),
      modelId: id,
      providerId: 'grok-build',
    });
  }

  return models;
};

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

/** Parse the fixed-width table emitted by `pi --list-models`. */
export const parsePiModelCatalog = (stdout: string): HeterogeneousAgentModel[] => {
  const seen = new Set<string>();
  const models: HeterogeneousAgentModel[] = [];

  for (const rawLine of stdout.split(/\r?\n/)) {
    const match = PI_MODEL_ROW_PATTERN.exec(rawLine.trim());
    if (!match) continue;

    const [, providerId, modelId] = match;
    const id = `${providerId}/${modelId}`;
    if (providerId === 'provider' || seen.has(id)) continue;

    seen.add(id);
    models.push({ id, modelId, providerId });
  }

  return models;
};

/**
 * Parse the one-column table emitted by `qodercli --list-models`.
 * Built-in models are selected by name; custom models append their modelID in
 * parentheses and must be selected by that id.
 */
export const parseQoderModelCatalog = (stdout: string): HeterogeneousAgentModel[] => {
  const seen = new Set<string>();
  const models: HeterogeneousAgentModel[] = [];

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line === 'MODEL') continue;

    const match = QODER_CUSTOM_MODEL_ROW_PATTERN.exec(line);
    const id = match?.[2] ?? line;
    // Qoder truncates model IDs longer than 40 characters in this human-readable
    // command. Do not persist an id that the native `--model` flag cannot resolve.
    if (id.endsWith('…') || seen.has(id)) continue;

    seen.add(id);
    models.push({
      id,
      ...(match?.[1] ? { label: match[1] } : {}),
      modelId: id,
      providerId: 'qoder',
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

const getCatalogErrorMessage = (
  code: HeterogeneousAgentModelCatalogErrorCode,
  type: ListHeterogeneousAgentModelsParams['type'],
): string => {
  const name = getHeterogeneousTypeLabel(type) ?? type;
  if (code === 'cli_not_found') return `${name} CLI was not found`;
  if (code === 'timeout') return `${name} model discovery timed out`;

  return `${name} model discovery failed`;
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
  const resolved = await resolveHeteroSpawnCommand(params.type, params.command);
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
    if (params.type === 'droid') {
      const models = await listDroidAcpModels({
        args: params.args,
        commandPath: resolved.command,
        cwd: params.cwd ?? process.cwd(),
        env: env as NodeJS.ProcessEnv,
        timeoutMs: MODEL_CATALOG_TIMEOUT_MS,
      });
      return { models, status: 'success', updatedAt };
    }

    if (params.type === 'trae') {
      const models = await listTraeAcpModels({
        args: params.args,
        commandPath: resolved.command,
        cwd: params.cwd ?? process.cwd(),
        env: env as NodeJS.ProcessEnv,
        timeoutMs: MODEL_CATALOG_TIMEOUT_MS,
      });
      return { models, status: 'success', updatedAt };
    }

    const args =
      params.type === 'codebuddy'
        ? ['--help']
        : params.type === 'grok-build' || params.type === 'opencode'
          ? ['models']
          : ['--list-models'];
    const spawnPlan = await resolveCliSpawnPlan(resolved.command, args);
    const { stderr, stdout } = await execFilePromise(spawnPlan.command, spawnPlan.args, {
      cwd: params.cwd,
      encoding: 'utf8',
      env: env as NodeJS.ProcessEnv,
      maxBuffer: MODEL_CATALOG_MAX_BUFFER,
      timeout: MODEL_CATALOG_TIMEOUT_MS,
      windowsHide: true,
    });

    if (params.type === 'codebuddy') {
      const models =
        parseCodeBuddyModelCatalogResult(String(stdout)) ??
        parseCodeBuddyModelCatalogResult(String(stderr));
      if (!models) {
        return {
          error: {
            code: 'command_failed',
            message: getCatalogErrorMessage('command_failed', params.type),
          },
          status: 'error',
          updatedAt,
        };
      }

      return { models, status: 'success', updatedAt };
    }

    return {
      models:
        params.type === 'cursor'
          ? parseCursorModelCatalog(String(stdout))
          : params.type === 'grok-build'
            ? parseGrokBuildModelCatalog(String(stdout))
            : params.type === 'pi'
              ? parsePiModelCatalog(String(stdout))
              : params.type === 'qoder'
                ? parseQoderModelCatalog(String(stdout))
                : parseOpenCodeModelCatalog(String(stdout)),
      status: 'success',
      updatedAt,
    };
  } catch (error) {
    const code = classifyCatalogError(error);
    return {
      error: { code, message: getCatalogErrorMessage(code, params.type) },
      status: 'error',
      updatedAt,
    };
  }
};
