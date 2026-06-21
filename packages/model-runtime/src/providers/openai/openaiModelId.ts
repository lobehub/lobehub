export type OpenAIModelIdSource = 'openRouter' | 'openai';

export interface ParsedOpenAIModelId {
  family: 'gpt';
  majorVersion: number;
  minorVersion?: number;
  modifiers: string[];
  normalizedModelId: string;
  source: OpenAIModelIdSource;
}

interface ExtractedOpenAIModelId {
  normalizedModelId: string;
  source: OpenAIModelIdSource;
}

export const systemToUserModels = new Set([
  'o1-preview',
  'o1-preview-2024-09-12',
  'o1-mini',
  'o1-mini-2024-09-12',
]);

// TODO: temporary implementation, needs to be refactored into model card display configuration
export const disableStreamModels = new Set([
  'o1',
  'o1-2024-12-17',
  'o1-pro',
  'o1-pro-2025-03-19',
  /*
  Official documentation shows no support, but actual testing shows Streaming is supported, temporarily commented out
  'o3-pro',
  'o3-pro-2025-06-10',
  */
  'computer-use-preview',
  'computer-use-preview-2025-03-11',
]);

// Static Responses API-only exceptions that do not follow the parsed GPT-5 rule.
export const responsesAPIModels = new Set([
  'o1-pro',
  'o1-pro-2025-03-19',
  'o3-deep-research',
  'o3-deep-research-2025-06-26',
  'o3-pro',
  'o3-pro-2025-06-10',
  'o4-mini-deep-research',
  'o4-mini-deep-research-2025-06-26',
  'codex-mini-latest',
  'computer-use-preview',
  'computer-use-preview-2025-03-11',
]);

const GPT_MODEL_PATTERN =
  /^gpt-(\d+)(?:\.(\d+))?(?:\b|[-.:])(?:-([a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*))?/;

const normalizeOpenAIModelId = (model: string): string | undefined => {
  const normalized = model.trim().toLowerCase();
  if (!normalized) return;

  return normalized.startsWith('openai/') ? normalized.slice('openai/'.length) : normalized;
};

const extractOpenAIModelId = (model: string): ExtractedOpenAIModelId | undefined => {
  const normalized = model.trim().toLowerCase();
  if (!normalized) return;

  if (normalized.startsWith('openai/')) {
    return { normalizedModelId: normalized.slice('openai/'.length), source: 'openRouter' };
  }

  if (normalized.startsWith('gpt-')) {
    return { normalizedModelId: normalized, source: 'openai' };
  }
};

const parseMinorVersion = (
  value: string | undefined,
): Pick<ParsedOpenAIModelId, 'minorVersion'> => {
  if (!value) return {};

  return {
    minorVersion: Number(value),
  };
};

const parseModifiers = (value: string | undefined): Pick<ParsedOpenAIModelId, 'modifiers'> => ({
  modifiers: value ? value.split('-') : [],
});

export const parseOpenAIModelId = (model: string): ParsedOpenAIModelId | undefined => {
  const extracted = extractOpenAIModelId(model);
  if (!extracted) return;

  const match = GPT_MODEL_PATTERN.exec(extracted.normalizedModelId);
  if (!match) return;

  const [, majorVersion, minorVersion, modifiers] = match;

  return {
    family: 'gpt',
    majorVersion: Number(majorVersion),
    normalizedModelId: extracted.normalizedModelId,
    source: extracted.source,
    ...parseMinorVersion(minorVersion),
    ...parseModifiers(modifiers),
  };
};

const isGPT5Model = (model: string): ParsedOpenAIModelId | undefined => {
  const parsed = parseOpenAIModelId(model);
  if (!parsed || parsed.majorVersion !== 5) return;

  return parsed;
};

const isNativeGPT5Model = (model: string): ParsedOpenAIModelId | undefined => {
  const parsed = isGPT5Model(model);
  if (!parsed || parsed.source !== 'openai') return;

  return parsed;
};

const hasModifier = (parsed: ParsedOpenAIModelId, modifier: string): boolean =>
  parsed.modifiers.includes(modifier);

const baseGPT5MiniResponsesModels = new Set(['gpt-5-mini', 'gpt-5-mini-2025-08-07']);

export const isGPT5ResponsesModel = (model: string): boolean => {
  const parsed = isNativeGPT5Model(model);
  if (!parsed) return false;

  if (hasModifier(parsed, 'chat')) return false;
  if (hasModifier(parsed, 'codex') || hasModifier(parsed, 'pro')) return true;
  if (baseGPT5MiniResponsesModels.has(parsed.normalizedModelId)) return true;

  return parsed.minorVersion !== undefined && parsed.minorVersion >= 2;
};

export const isResponsesAPIModel = (model: string): boolean =>
  responsesAPIModels.has(model) || isGPT5ResponsesModel(model);

export const isGPT5ProResponsesModel = (model: string): boolean => {
  const parsed = isNativeGPT5Model(model);
  return !!parsed && hasModifier(parsed, 'pro');
};

export const supportsGPT5ResponsesReasoningEffortNone = (model: string): boolean => {
  const parsed = isNativeGPT5Model(model);
  if (!parsed || parsed.minorVersion === undefined) return false;

  return !hasModifier(parsed, 'pro');
};

export const isOpenAIReasoningPayloadModel = (model: string): boolean => {
  const normalizedModelId = normalizeOpenAIModelId(model);
  if (!normalizedModelId) return false;

  return (
    !!isGPT5Model(model) || /^(?:o[134]|codex|computer-use)(?:$|[-.:])/.test(normalizedModelId)
  );
};

export const isOpenAIComputerUseModel = (model: string): boolean => {
  const normalizedModelId = normalizeOpenAIModelId(model);
  return !!normalizedModelId && /^computer-use(?:$|[-.:])/.test(normalizedModelId);
};

export const supportsOpenAIServiceTierFlex = (model: string): boolean => {
  const normalizedModelId = normalizeOpenAIModelId(model);
  if (!normalizedModelId) return false;

  if (isGPT5Model(model)) return true;
  if (/^o3-mini(?:$|[-.:])/.test(normalizedModelId)) return false;

  return /^(?:o3|o4-mini)(?:$|[-.:])/.test(normalizedModelId);
};
