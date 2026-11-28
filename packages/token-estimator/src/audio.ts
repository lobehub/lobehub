export const DEFAULT_AUDIO_INPUT_TOKEN_ESTIMATE = 1000;

export type AudioTokenEstimateSource = 'duration' | 'fallback' | 'mixed' | 'none';

export interface AudioInputTokenEstimate {
  durationItemCount: number;
  fallbackItemCount: number;
  source: AudioTokenEstimateSource;
  tokens: number;
}

export interface AudioTokenEstimateOptions {
  /** Conservative per-item fallback used when duration or the model rate is unavailable. */
  fallbackTokensPerItem?: number;
  /** Model-specific audio input token rate. Invalid or non-positive values are ignored. */
  tokensPerSecond?: number;
}

export const normalizeAudioDurationMs = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;

  return Math.ceil(value);
};

export const normalizeAudioTokensPerSecond = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;

  return value;
};

/**
 * Reads only the supported duration field from file metadata. Other metadata must never be
 * materialized onto chat audio items.
 */
export const readAudioDurationMs = (metadata: unknown): number | undefined => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;

  return normalizeAudioDurationMs((metadata as { durationMs?: unknown }).durationMs);
};

/**
 * Estimates audio input tokens without inspecting or fetching media URLs.
 *
 * Duration-based estimates are rounded up per item, but duration is an untrusted client hint and
 * therefore cannot reduce an estimate below the conservative fixed fallback. Items without both a
 * valid duration and a valid model rate use that fallback directly so pre-flight checks never
 * silently treat audio as free.
 */
export const estimateAudioInputTokens = (
  items: ReadonlyArray<{ durationMs?: unknown }>,
  options: AudioTokenEstimateOptions = {},
): AudioInputTokenEstimate => {
  const tokensPerSecond = normalizeAudioTokensPerSecond(options.tokensPerSecond);
  const fallbackTokensPerItem =
    normalizeAudioTokensPerSecond(options.fallbackTokensPerItem) ??
    DEFAULT_AUDIO_INPUT_TOKEN_ESTIMATE;
  let durationItemCount = 0;
  let fallbackItemCount = 0;
  let tokens = 0;

  for (const item of items) {
    const durationMs = normalizeAudioDurationMs(item.durationMs);

    if (durationMs !== undefined && tokensPerSecond !== undefined) {
      const durationTokens = Math.ceil((durationMs / 1000) * tokensPerSecond);
      tokens += Math.max(durationTokens, Math.ceil(fallbackTokensPerItem));
      durationItemCount += 1;
      continue;
    }

    tokens += Math.ceil(fallbackTokensPerItem);
    fallbackItemCount += 1;
  }

  const source: AudioTokenEstimateSource =
    durationItemCount > 0 && fallbackItemCount > 0
      ? 'mixed'
      : durationItemCount > 0
        ? 'duration'
        : fallbackItemCount > 0
          ? 'fallback'
          : 'none';

  return { durationItemCount, fallbackItemCount, source, tokens };
};
