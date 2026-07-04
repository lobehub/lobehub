import type { UsageData } from '../types';

export interface CodexUsagePayload {
  cached_input_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
}

export const toCodexUsageData = (
  raw: CodexUsagePayload | null | undefined,
): UsageData | undefined => {
  if (!raw) return undefined;

  const inputCachedTokens = raw.cached_input_tokens || 0;
  // Codex reports `input_tokens` as total input; cached input is a subset.
  const totalInputTokens = Math.max(raw.input_tokens || 0, inputCachedTokens);
  const inputCacheMissTokens = Math.max(0, totalInputTokens - inputCachedTokens);
  const totalOutputTokens = raw.output_tokens || 0;

  if (totalInputTokens + totalOutputTokens === 0) return undefined;

  return {
    inputCachedTokens: inputCachedTokens || undefined,
    inputCacheMissTokens,
    totalInputTokens,
    totalOutputTokens,
    totalTokens: totalInputTokens + totalOutputTokens,
  };
};

const isMonotonicUsage = (current: UsageData, previous: UsageData) =>
  current.inputCacheMissTokens >= previous.inputCacheMissTokens &&
  (current.inputCachedTokens || 0) >= (previous.inputCachedTokens || 0) &&
  current.totalInputTokens >= previous.totalInputTokens &&
  current.totalOutputTokens >= previous.totalOutputTokens &&
  current.totalTokens >= previous.totalTokens;

export const toTurnUsageFromCumulative = (
  current: UsageData | undefined,
  previous: UsageData | undefined,
): UsageData | undefined => {
  if (!current || !previous) return current;
  if (!isMonotonicUsage(current, previous)) return current;

  const inputCacheMissTokens = current.inputCacheMissTokens - previous.inputCacheMissTokens;
  const inputCachedTokens = (current.inputCachedTokens || 0) - (previous.inputCachedTokens || 0);
  const totalInputTokens = current.totalInputTokens - previous.totalInputTokens;
  const totalOutputTokens = current.totalOutputTokens - previous.totalOutputTokens;
  const totalTokens = totalInputTokens + totalOutputTokens;

  if (totalTokens === 0) return undefined;

  return {
    inputCachedTokens: inputCachedTokens || undefined,
    inputCacheMissTokens,
    totalInputTokens,
    totalOutputTokens,
    totalTokens,
  };
};
