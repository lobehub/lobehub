import { readdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { UsageData } from '../types';

type KimiCodeEnv = Record<string, string | undefined>;

/**
 * Usage shape Kimi Code writes into the session wire log
 * (`<kimiHome>/sessions/<wd_key>/<session_id>/agents/main/wire.jsonl`).
 * One record per model request; `inputOther` is the cache-miss portion.
 */
export interface KimiCodeWireUsage {
  inputCacheCreation?: number;
  inputCacheRead?: number;
  inputOther?: number;
  output?: number;
}

/**
 * One usage-bearing wire-log line. Current CLI versions tag these with
 * `type: 'usage.record'` and carry the request's `model` alongside `usage`;
 * older/untyped lines that just have a top-level `usage` are tolerated.
 */
export interface KimiCodeWireUsageRecord {
  model?: string;
  usage: KimiCodeWireUsage;
}

/** Aggregated session usage plus the model the usage was consumed with. */
export interface KimiCodeSessionUsage {
  model?: string;
  usage: UsageData;
}

export interface ReadKimiCodeSessionUsageOptions {
  env?: KimiCodeEnv;
  homeDir?: string;
  /**
   * The CLI may still be flushing the wire log right after process exit, so
   * the read retries while no usage is found. Defaults to 3 attempts.
   */
  maxAttempts?: number;
  /** Delay between attempts. Defaults to 400ms (~1s total budget). */
  retryDelayMs?: number;
}

export const getKimiCodeHome = (
  env: KimiCodeEnv = process.env,
  homeDir: string = os.homedir(),
): string => {
  const configured = env.KIMI_CODE_HOME?.trim();
  return configured || path.join(homeDir, '.kimi-code');
};

const toFiniteNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

/**
 * Map one wire-log usage record into the provider-agnostic `UsageData` shape.
 * Cache fields mirror Claude Code's Anthropic mapping (`toUsageData`):
 * `inputOther` ≈ `input_tokens` (cache miss), `inputCacheRead` ≈
 * `cache_read_input_tokens`, `inputCacheCreation` ≈ `cache_creation_input_tokens`.
 */
export const toKimiCodeUsageData = (
  raw: KimiCodeWireUsage | null | undefined,
): UsageData | undefined => {
  if (!raw) return undefined;
  const inputCacheMissTokens = toFiniteNumber(raw.inputOther);
  const inputCachedTokens = toFiniteNumber(raw.inputCacheRead);
  const inputWriteCacheTokens = toFiniteNumber(raw.inputCacheCreation);
  const totalInputTokens = inputCacheMissTokens + inputCachedTokens + inputWriteCacheTokens;
  const totalOutputTokens = toFiniteNumber(raw.output);
  if (totalInputTokens + totalOutputTokens === 0) return undefined;
  return {
    inputCacheMissTokens,
    inputCachedTokens: inputCachedTokens || undefined,
    inputWriteCacheTokens: inputWriteCacheTokens || undefined,
    totalInputTokens,
    totalOutputTokens,
    totalTokens: totalInputTokens + totalOutputTokens,
  };
};

/**
 * Sum multiple per-request wire-log usage records into a single grand total,
 * matching the semantic of Claude Code's `result` event usage. The model is
 * taken from the LAST usage-bearing record — all records in one session agree.
 */
export const aggregateKimiCodeUsage = (
  records: KimiCodeWireUsageRecord[],
): KimiCodeSessionUsage | undefined => {
  let inputCacheMissTokens = 0;
  let inputCachedTokens = 0;
  let inputWriteCacheTokens = 0;
  let totalOutputTokens = 0;
  let model: string | undefined;
  let seen = false;

  for (const record of records) {
    const usage = toKimiCodeUsageData(record.usage);
    if (!usage) continue;
    seen = true;
    if (record.model) model = record.model;
    inputCacheMissTokens += usage.inputCacheMissTokens;
    inputCachedTokens += usage.inputCachedTokens || 0;
    inputWriteCacheTokens += usage.inputWriteCacheTokens || 0;
    totalOutputTokens += usage.totalOutputTokens;
  }

  if (!seen) return undefined;
  const totalInputTokens = inputCacheMissTokens + inputCachedTokens + inputWriteCacheTokens;
  return {
    model,
    usage: {
      inputCacheMissTokens,
      inputCachedTokens: inputCachedTokens || undefined,
      inputWriteCacheTokens: inputWriteCacheTokens || undefined,
      totalInputTokens,
      totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
    },
  };
};

const hasUsageShape = (value: unknown): value is KimiCodeWireUsage =>
  !!value &&
  typeof value === 'object' &&
  ('inputOther' in value || 'inputCacheRead' in value || 'output' in value);

const getNonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

/** Extract every usage record from wire.jsonl content, skipping malformed lines. */
export const parseKimiCodeWireUsage = (content: string): KimiCodeWireUsageRecord[] => {
  const records: KimiCodeWireUsageRecord[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes('"usage"')) continue;
    try {
      const record = JSON.parse(trimmed);
      // Typed lines must be usage records; untyped legacy lines with a
      // top-level `usage` are tolerated.
      if (record?.type !== undefined && record.type !== 'usage.record') continue;
      if (hasUsageShape(record?.usage)) {
        records.push({ model: getNonEmptyString(record.model), usage: record.usage });
      }
    } catch {
      continue;
    }
  }
  return records;
};

/**
 * Locate the session's `agents/main/wire.jsonl` under the Kimi home.
 * Sessions live at `sessions/<wd_key>/<session_id>/`; the working-directory
 * key segment is derived from the cwd and not reconstructable here, so match
 * every session bucket and keep the newest.
 */
const findWireLog = async (kimiHome: string, sessionId: string): Promise<string | undefined> => {
  let buckets;
  try {
    buckets = await readdir(path.join(kimiHome, 'sessions'), { withFileTypes: true });
  } catch {
    return;
  }

  const candidates = await Promise.all(
    buckets
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const file = path.join(
          kimiHome,
          'sessions',
          entry.name,
          sessionId,
          'agents',
          'main',
          'wire.jsonl',
        );
        try {
          const info = await stat(file);
          return info.isFile() ? { file, mtimeMs: info.mtimeMs } : undefined;
        } catch {
          return;
        }
      }),
  );

  const matches = candidates.filter((item): item is { file: string; mtimeMs: number } => !!item);
  matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return matches[0]?.file;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Read the aggregated token usage (and the model it was consumed with) for a
 * finished Kimi Code run from its session wire log. Best-effort by contract:
 * any failure (no session id, missing home/log, parse errors) resolves to
 * `undefined` and never throws.
 */
export const readKimiCodeSessionUsage = async (
  sessionId: string | undefined,
  {
    env = process.env,
    homeDir,
    maxAttempts = 3,
    retryDelayMs = 400,
  }: ReadKimiCodeSessionUsageOptions = {},
): Promise<KimiCodeSessionUsage | undefined> => {
  if (!sessionId) return;

  const kimiHome = getKimiCodeHome(env, homeDir);
  const attempts = Math.max(1, maxAttempts);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const wireLog = await findWireLog(kimiHome, sessionId);
    if (wireLog) {
      const content = await readFile(wireLog, 'utf8').catch(() => undefined);
      const result = content ? aggregateKimiCodeUsage(parseKimiCodeWireUsage(content)) : undefined;
      if (result) return result;
    }
    if (attempt < attempts - 1) await sleep(retryDelayMs);
  }
};
