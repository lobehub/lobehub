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

export const isKimiNativeThinkingModel = (model: string): boolean => {
  const parsed = parseKimiModelId(model);
  if (!parsed) return false;

  if (parsed.majorVersion !== 2) return false;
  if (hasVariant(parsed, 'thinking')) return true;

  return (
    hasVariant(parsed, 'code') && parsed.minorVersion !== undefined && parsed.minorVersion >= 7
  );
};

export const isKimiAlwaysPreserveThinkingModel = (model: string): boolean => {
  const parsed = parseKimiModelId(model);
  if (!parsed) return false;

  return (
    parsed.majorVersion === 2 &&
    hasVariant(parsed, 'code') &&
    parsed.minorVersion !== undefined &&
    parsed.minorVersion >= 7
  );
};

export const isKimiThinkingToggleModel = (model: string): boolean => {
  const parsed = parseKimiModelId(model);
  if (!parsed) return false;

  return (
    parsed.majorVersion === 2 &&
    parsed.minorVersion !== undefined &&
    !isKimiNativeThinkingModel(model)
  );
};

export const isKimiPreserveThinkingModel = (model: string): boolean => {
  const parsed = parseKimiModelId(model);
  if (!parsed) return false;

  return parsed.majorVersion === 2 && parsed.minorVersion === 6;
};
