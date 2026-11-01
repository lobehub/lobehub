import type { UsageData } from '../types';

export interface CodexUsagePayload {
  cached_input_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
}

const getValidReasoningOutputTokens = (
  value: unknown,
  totalOutputTokens: number,
): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= totalOutputTokens
    ? value
    : undefined;

export const toCodexUsageData = (
  raw: CodexUsagePayload | null | undefined,
): UsageData | undefined => {
  if (!raw) return undefined;

  const inputCachedTokens = raw.cached_input_tokens || 0;
  // Codex reports `input_tokens` as total input; cached input is a subset.
  const totalInputTokens = Math.max(raw.input_tokens || 0, inputCachedTokens);
  const inputCacheMissTokens = Math.max(0, totalInputTokens - inputCachedTokens);
  const totalOutputTokens = raw.output_tokens || 0;
  const outputReasoningTokens = getValidReasoningOutputTokens(
    raw.reasoning_output_tokens,
    totalOutputTokens,
  );

  if (totalInputTokens + totalOutputTokens === 0) return undefined;

  return {
    inputCachedTokens: inputCachedTokens || undefined,
    inputCacheMissTokens,
    ...(outputReasoningTokens === undefined
      ? {}
      : {
          outputReasoningTokens,
          outputTextTokens: totalOutputTokens - outputReasoningTokens,
        }),
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

const getTurnOutputBreakdown = (
  current: UsageData,
  previous: UsageData,
  totalOutputTokens: number,
): Pick<UsageData, 'outputReasoningTokens' | 'outputTextTokens'> | undefined => {
  const currentReasoning = current.outputReasoningTokens;
  const currentText = current.outputTextTokens;
  const previousReasoning = previous.outputReasoningTokens;
  const previousText = previous.outputTextTokens;

  if (
    currentReasoning === undefined ||
    currentText === undefined ||
    previousReasoning === undefined ||
    previousText === undefined ||
    !Number.isFinite(currentReasoning) ||
    !Number.isFinite(currentText) ||
    !Number.isFinite(previousReasoning) ||
    !Number.isFinite(previousText) ||
    currentReasoning < 0 ||
    currentText < 0 ||
    previousReasoning < 0 ||
    previousText < 0 ||
    currentReasoning + currentText !== current.totalOutputTokens ||
    previousReasoning + previousText !== previous.totalOutputTokens ||
    currentReasoning < previousReasoning ||
    currentText < previousText
  ) {
    return undefined;
  }

  const outputReasoningTokens = currentReasoning - previousReasoning;
  const outputTextTokens = currentText - previousText;

  if (outputReasoningTokens + outputTextTokens !== totalOutputTokens) return undefined;

  return { outputReasoningTokens, outputTextTokens };
};

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
  const outputBreakdown = getTurnOutputBreakdown(current, previous, totalOutputTokens);

  if (totalTokens === 0) return undefined;

  return {
    inputCachedTokens: inputCachedTokens || undefined,
    inputCacheMissTokens,
    ...outputBreakdown,
    totalInputTokens,
    totalOutputTokens,
    totalTokens,
  };
};
