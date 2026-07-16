export type KimiModelIdSource = 'moonshot' | 'openRouter';

export interface ParsedKimiModelId {
  family: 'k';
  majorVersion: number;
  minorVersion?: number;
  normalizedModelId: string;
  source: KimiModelIdSource;
  variant?: string;
}

interface ExtractedKimiModelId {
  normalizedModelId: string;
  source: KimiModelIdSource;
}

const KIMI_MODEL_PATTERN =
  /^kimi-k(\d+)(?:\.(\d+))?(?:-([a-z][a-z0-9]*(?:-[a-z0-9]+)*))?(?:\b|[-.:])/;

const extractKimiModelId = (model: string): ExtractedKimiModelId | undefined => {
  const normalized = model.trim().toLowerCase();
  if (!normalized) return;

  if (normalized.startsWith('moonshotai/')) {
    return { normalizedModelId: normalized.slice('moonshotai/'.length), source: 'openRouter' };
  }

  if (normalized.startsWith('kimi-')) {
    return { normalizedModelId: normalized, source: 'moonshot' };
  }
};

const parseMinorVersion = (value: string | undefined): Pick<ParsedKimiModelId, 'minorVersion'> => {
  if (!value || !/^\d{1,2}$/.test(value)) return {};

  return {
    minorVersion: Number(value),
  };
};

export const parseKimiModelId = (model: string): ParsedKimiModelId | undefined => {
  const extracted = extractKimiModelId(model);
  if (!extracted) return;

  const match = KIMI_MODEL_PATTERN.exec(extracted.normalizedModelId);
  if (!match) return;

  const [, majorVersion, minorVersion, variant] = match;

  return {
    family: 'k',
    majorVersion: Number(majorVersion),
    normalizedModelId: extracted.normalizedModelId,
    source: extracted.source,
    ...(variant ? { variant } : {}),
    ...parseMinorVersion(minorVersion),
  };
};

const hasVariant = (parsed: ParsedKimiModelId, variant: string): boolean =>
  parsed.variant === variant || !!parsed.variant?.startsWith(`${variant}-`);

/**
 * Whether the parsed model is at or after a given kimi generation, e.g.
 * `isAtLeastGeneration(parsed, 2, 6)` matches k2.6, k2.7, k3, k3.1...
 * Legacy ids without a minor version (kimi-k2-0711-preview) count as minor 0.
 */
const isAtLeastGeneration = (parsed: ParsedKimiModelId, major: number, minor = 0): boolean =>
  parsed.majorVersion > major ||
  (parsed.majorVersion === major && (parsed.minorVersion ?? 0) >= minor);

/**
 * Models whose thinking is always on and cannot be disabled: the legacy
 * `-thinking` variants (kimi-k2-thinking) and `-code` variants since k2.7
 * (kimi-k2.7-code always errors on `thinking: {type: 'disabled'}`).
 * Future `-code` / `-thinking` variants (k3+) are assumed to keep this behavior.
 */
export const isKimiNativeThinkingModel = (model: string): boolean => {
  const parsed = parseKimiModelId(model);
  if (!parsed) return false;

  if (parsed.majorVersion < 2) return false;
  if (hasVariant(parsed, 'thinking')) return true;

  return hasVariant(parsed, 'code') && isAtLeastGeneration(parsed, 2, 7);
};

/**
 * Models with Preserved Thinking always active (`thinking.keep` is treated as
 * 'all' whether passed or not): `-code` variants since kimi-k2.7-code.
 */
export const isKimiAlwaysPreserveThinkingModel = (model: string): boolean => {
  const parsed = parseKimiModelId(model);
  if (!parsed) return false;

  return hasVariant(parsed, 'code') && isAtLeastGeneration(parsed, 2, 7);
};

/**
 * Models that accept `thinking: {type: 'enabled' | 'disabled'}` with fixed
 * sampling params (temperature 1/0.6, top_p 0.95, penalties 0).
 * For k2 an explicit minor version is required (k2.5/k2.6) — bare legacy
 * kimi-k2-* ids (e.g. kimi-k2-0711-preview) predate the toggle. From k3 on the
 * whole generation is assumed to follow k2.6 semantics until official docs land.
 */
export const isKimiThinkingToggleModel = (model: string): boolean => {
  const parsed = parseKimiModelId(model);
  if (!parsed) return false;
  if (isKimiNativeThinkingModel(model)) return false;

  if (parsed.majorVersion === 2) return parsed.minorVersion !== undefined;
  return parsed.majorVersion > 2;
};

/**
 * Models that accept the optional `thinking.keep: 'all'` param, introduced in
 * kimi-k2.6 (kimi-k2.5 rejects it) and assumed inherited by k3+. Excludes
 * always-preserve models (kimi-k2.7-code) where passing the param is redundant.
 */
export const isKimiPreserveThinkingModel = (model: string): boolean => {
  const parsed = parseKimiModelId(model);
  if (!parsed) return false;

  return isAtLeastGeneration(parsed, 2, 6) && !isKimiAlwaysPreserveThinkingModel(model);
};

/**
 * Kimi models that expose `reasoning_content` on the OpenAI-compatible route:
 * dot-versioned k2 models (k2.5/k2.6/k2.7-code) and every generation after.
 */
export const isKimiReasoningModel = (model: string): boolean => {
  const parsed = parseKimiModelId(model);
  if (!parsed) return false;

  return (
    parsed.majorVersion > 2 || (parsed.majorVersion === 2 && parsed.minorVersion !== undefined)
  );
};
