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
 * `-thinking` variants (kimi-k2-thinking), `-code` variants since k2.7
 * (kimi-k2.7-code errors on `thinking: {type: 'disabled'}`), and the entire
 * k3+ generation ("K3 always runs with thinking enabled").
 * Docs: https://platform.kimi.com/docs/guide/kimi-k3-quickstart
 */
export const isKimiNativeThinkingModel = (model: string): boolean => {
  const parsed = parseKimiModelId(model);
  if (!parsed) return false;

  if (parsed.majorVersion >= 3) return true;
  if (parsed.majorVersion < 2) return false;
  if (hasVariant(parsed, 'thinking')) return true;

  return hasVariant(parsed, 'code') && isAtLeastGeneration(parsed, 2, 7);
};

/**
 * Models (k3+) that configure reasoning strength via the top-level
 * OpenAI-style `reasoning_effort` field. The K2.x `thinking` param does not
 * apply to them and must not be sent.
 * Docs: https://platform.kimi.com/docs/api/models-overview
 */
export const isKimiReasoningEffortModel = (model: string): boolean => {
  const parsed = parseKimiModelId(model);
  if (!parsed) return false;

  return parsed.majorVersion >= 3;
};

/**
 * Models that must round-trip the complete assistant message (including
 * `reasoning_content`) across turns with no opt-out: `-code` variants since
 * kimi-k2.7-code (Preserved Thinking always active) and the whole k3+
 * generation.
 */
export const isKimiAlwaysPreserveThinkingModel = (model: string): boolean => {
  const parsed = parseKimiModelId(model);
  if (!parsed) return false;

  if (parsed.majorVersion >= 3) return true;

  return hasVariant(parsed, 'code') && isAtLeastGeneration(parsed, 2, 7);
};

/**
 * K2.x models that accept `thinking: {type: 'enabled' | 'disabled'}` with
 * fixed sampling params (temperature 1/0.6, top_p 0.95, penalties 0):
 * kimi-k2.5 and kimi-k2.6. Bare legacy kimi-k2-* ids (e.g.
 * kimi-k2-0711-preview) predate the toggle, and k3+ replaced the `thinking`
 * param with top-level `reasoning_effort`.
 */
export const isKimiThinkingToggleModel = (model: string): boolean => {
  const parsed = parseKimiModelId(model);
  if (!parsed) return false;
  if (isKimiNativeThinkingModel(model)) return false;

  return parsed.majorVersion === 2 && parsed.minorVersion !== undefined;
};

/**
 * Models that accept the optional `thinking.keep: 'all'` param — kimi-k2.6
 * only: kimi-k2.5 rejects it, kimi-k2.7-code always preserves (param
 * redundant), and k3+ has no `thinking` param at all.
 */
export const isKimiPreserveThinkingModel = (model: string): boolean => {
  const parsed = parseKimiModelId(model);
  if (!parsed) return false;

  return parsed.majorVersion === 2 && parsed.minorVersion === 6;
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
