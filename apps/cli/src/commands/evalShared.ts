import { InvalidArgumentError } from 'commander';
import pc from 'picocolors';

import { log } from '../utils/logger';

export const JSON_VERSION = 'v1' as const;

export interface JsonError {
  code?: string;
  message: string;
}

export interface JsonEnvelope<T> {
  data: T | null;
  error: JsonError | null;
  ok: boolean;
  version: typeof JSON_VERSION;
}

export interface JsonOption {
  json?: boolean;
}

export const printJson = (data: unknown) => {
  console.log(JSON.stringify(data, null, 2));
};

export const outputJsonSuccess = (data: unknown) => {
  const payload: JsonEnvelope<unknown> = {
    data,
    error: null,
    ok: true,
    version: JSON_VERSION,
  };
  printJson(payload);
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const getCreatedId = (value: unknown) => {
  if (!isRecord(value)) return undefined;
  if (typeof value.id === 'string') return value.id;
  return isRecord(value.data) && typeof value.data.id === 'string' ? value.data.id : undefined;
};

export const withResourceUrl = (
  buildUrl: (pathname: string) => string,
  data: unknown,
  pathname: string,
) => ({
  ...(isRecord(data) ? data : { data }),
  url: buildUrl(pathname),
});

export const toJsonError = (error: unknown): JsonError => {
  if (error instanceof Error) {
    const maybeData = (error as Error & { data?: { code?: string } }).data;
    const code = maybeData?.code;

    return {
      code: typeof code === 'string' ? code : undefined,
      message: error.message,
    };
  }

  if (isRecord(error)) {
    const code = typeof error.code === 'string' ? error.code : undefined;
    const message = typeof error.message === 'string' ? error.message : 'Unknown error';
    return { code, message };
  }

  return { message: String(error) };
};

export const handleCommandError = (error: unknown, json: boolean) => {
  const normalized = toJsonError(error);

  if (json) {
    const payload: JsonEnvelope<null> = {
      data: null,
      error: normalized,
      ok: false,
      version: JSON_VERSION,
    };
    printJson(payload);
  } else {
    log.error(normalized.message);
  }

  process.exit(1);
};

export const parseScore = (value: string) => {
  const score = Number(value);
  if (!Number.isFinite(score)) {
    throw new InvalidArgumentError(`Invalid score: ${value}`);
  }
  return score;
};

export const parseBoolean = (value: string) => {
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes'].includes(normalized)) return true;
  if (['0', 'false', 'no'].includes(normalized)) return false;
  throw new InvalidArgumentError(`Invalid boolean value: ${value}`);
};

export const parseResultJson = (value: string) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new InvalidArgumentError('Invalid JSON value for --result-json');
  }

  if (!isRecord(parsed) || Array.isArray(parsed)) {
    throw new InvalidArgumentError('--result-json must be a JSON object');
  }

  return parsed;
};

export const parseJsonObject = (option: string) => (value: string) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new InvalidArgumentError(`Invalid JSON value for ${option}`);
  }
  if (!isRecord(parsed) || Array.isArray(parsed)) {
    throw new InvalidArgumentError(`${option} must be a JSON object`);
  }
  return parsed;
};

export const RUN_SET_STATUSES = ['running', 'completed', 'external', 'failed', 'aborted'] as const;
export type RunSetStatus = (typeof RUN_SET_STATUSES)[number];

export const parseRunStatus = (value: string): RunSetStatus => {
  if (!(RUN_SET_STATUSES as readonly string[]).includes(value)) {
    throw new InvalidArgumentError(
      `Only ${RUN_SET_STATUSES.map((s) => `'${s}'`).join(', ')} are supported`,
    );
  }

  return value as RunSetStatus;
};

export const executeCommand = async (
  options: JsonOption,
  action: () => Promise<unknown>,
  successMessage?: string,
) => {
  try {
    const data = await action();
    if (options.json) {
      outputJsonSuccess(data);
      return;
    }

    // The action already printed a human-readable view.
    if (data === undefined) return;

    if (successMessage) {
      console.log(`${pc.green('OK')} ${successMessage}`);
      if (isRecord(data) && typeof data.url === 'string') {
        console.log(`${pc.bold('url')}: ${data.url}`);
      }
      return;
    }

    printJson(data);
  } catch (error) {
    handleCommandError(error, Boolean(options.json));
  }
};
