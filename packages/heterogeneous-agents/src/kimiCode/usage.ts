/**
 * Kimi Code session usage — the wire-log format and how it maps to UsageData.
 *
 * Pure on purpose: nothing here touches the file system, so the adapter (which
 * is also bundled for the browser) can import it. Reading the log from disk
 * lives in `./sessionUsage`, which only the Node spawn pipeline loads.
 */
import type { UsageData } from '../types';

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

const KIMI_CODE_MODEL_PREFIX = 'kimi-code/';

/**
 * The wire log names models with the provider namespace (`kimi-code/k3`).
 * The provider is persisted separately as `kimi-code`, so the stored model
 * keeps only the `kimi-` family form — a value without the prefix passes
 * through unchanged.
 */
const toKimiModelName = (model: string): string =>
  model.startsWith(KIMI_CODE_MODEL_PREFIX)
    ? `kimi-${model.slice(KIMI_CODE_MODEL_PREFIX.length)}`
    : model;

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
    if (record.model) model = toKimiModelName(record.model);
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
