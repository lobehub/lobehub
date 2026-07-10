export type GoogleModelIdSource = 'google' | 'googlePrefixed' | 'vertexAi';
export type GoogleModelFamily = 'gemini' | 'gemma' | 'learnlm' | 'nanoBanana';

export interface ParsedGoogleModelId {
  family: GoogleModelFamily;
  majorVersion?: number;
  minorVersion?: number;
  modifiers: string[];
  normalizedModelId: string;
  source: GoogleModelIdSource;
}

interface ExtractedGoogleModelId {
  normalizedModelId: string;
  source: GoogleModelIdSource;
}

const VERSIONED_GOOGLE_MODEL_PATTERN =
  /^(gemini|gemma)-(\d+)(?:\.(\d+))?(?:[-.:]([a-z][a-z0-9]*(?:[-.:][a-z0-9]+)*))?/;

const LEGACY_GEMINI_MODEL_PATTERN = /^gemini[-.:]([a-z][a-z0-9]*(?:[-.:][a-z0-9]+)*)/;
const LEARNLM_MODEL_PATTERN = /^learnlm[-.:]?([a-z0-9]+(?:[-.:][a-z0-9]+)*)?/;
const NANO_BANANA_MODEL_PATTERN = /^nano-banana[-.:]?([a-z0-9]+(?:[-.:][a-z0-9]+)*)?/;

const SAFETY_OFF_MODELS = new Set(['gemini-2.0-flash-exp']);

const IMAGE_RESPONSE_MODEL_ALIASES = new Set(['gemini-2.0-flash-exp', 'nano-banana-pro-preview']);

const LOBE_IMAGE_MODEL_ID_SUFFIX = ':image';

const NANO_BANANA_MODEL_ALIASES = new Set([
  'gemini-2.5-flash-image-preview',
  'gemini-2.5-flash-image',
  'gemini-3-pro-image',
  'gemini-3-pro-image-preview',
  'gemini-3.1-flash-image',
  'gemini-3.1-flash-image-preview',
  'gemini-3.1-flash-lite-image',
  'nano-banana-pro-preview',
]);

// These models need the explicit image/web searchTypes payload when googleSearch is enabled.
// Other search-capable models use the plain `{ googleSearch: {} }` shape.
const IMAGE_SEARCH_TYPES_MODELS = new Set(['gemini-3.1-flash-image-preview']);

// Models verified to reject systemInstruction/thinkingConfig. Other cases are derived below
// only when the model-id shape is stable enough to avoid a release-time code change.
const SYSTEM_INSTRUCTION_DISABLED_MODELS = new Set([
  'gemini-2.0-flash-exp',
  'gemini-2.0-flash-exp-image-generation',
  'gemini-2.0-flash-preview-image-generation',
  'gemini-2.5-flash-image-preview',
  'gemini-2.5-flash-image',
]);

const extractGoogleModelId = (model: string): ExtractedGoogleModelId | undefined => {
  const normalized = model.trim().toLowerCase();
  if (!normalized) return;

  if (normalized.startsWith('google/')) {
    return {
      normalizedModelId: normalized.slice('google/'.length),
      source: 'googlePrefixed',
    };
  }

  const vertexModelPathIndex = normalized.lastIndexOf('/models/');
  if (vertexModelPathIndex >= 0) {
    return {
      normalizedModelId: normalized.slice(vertexModelPathIndex + '/models/'.length),
      source: 'vertexAi',
    };
  }

  if (normalized.startsWith('models/')) {
    return {
      normalizedModelId: normalized.slice('models/'.length),
      source: 'google',
    };
  }

  if (
    normalized.startsWith('gemini-') ||
    normalized.startsWith('gemma-') ||
    normalized.startsWith('learnlm') ||
    normalized.startsWith('nano-banana')
  ) {
    return { normalizedModelId: normalized, source: 'google' };
  }
};

export const normalizeGoogleModelId = (model: string): string | undefined =>
  extractGoogleModelId(model)?.normalizedModelId;

const normalizeGoogleModelIdForAlias = (model: string): string | undefined => {
  const normalizedModelId = normalizeGoogleModelId(model);
  if (!normalizedModelId) return;

  // Lobe image model cards append `:image`, e.g. gemini-3.1-flash-lite-image:image.
  return normalizedModelId.endsWith(LOBE_IMAGE_MODEL_ID_SUFFIX)
    ? normalizedModelId.slice(0, -LOBE_IMAGE_MODEL_ID_SUFFIX.length)
    : normalizedModelId;
};

const parseModifiers = (value?: string): string[] => (value ? value.split(/[-.:]/) : []);

const parseMinorVersion = (
  value: string | undefined,
): Pick<ParsedGoogleModelId, 'minorVersion'> => {
  if (!value) return {};

  return { minorVersion: Number(value) };
};

export const parseGoogleModelId = (model: string): ParsedGoogleModelId | undefined => {
  const extracted = extractGoogleModelId(model);
  if (!extracted) return;

  const versionedMatch = VERSIONED_GOOGLE_MODEL_PATTERN.exec(extracted.normalizedModelId);
  if (versionedMatch) {
    const [, family, majorVersion, minorVersion, modifiers] = versionedMatch;

    return {
      family: family as GoogleModelFamily,
      majorVersion: Number(majorVersion),
      modifiers: parseModifiers(modifiers),
      normalizedModelId: extracted.normalizedModelId,
      source: extracted.source,
      ...parseMinorVersion(minorVersion),
    };
  }

  const legacyGeminiMatch = LEGACY_GEMINI_MODEL_PATTERN.exec(extracted.normalizedModelId);
  if (legacyGeminiMatch) {
    const [, modifiers] = legacyGeminiMatch;

    return {
      family: 'gemini',
      modifiers: parseModifiers(modifiers),
      normalizedModelId: extracted.normalizedModelId,
      source: extracted.source,
    };
  }

  const learnLMMatch = LEARNLM_MODEL_PATTERN.exec(extracted.normalizedModelId);
  if (learnLMMatch) {
    const [, modifiers] = learnLMMatch;

    return {
      family: 'learnlm',
      modifiers: parseModifiers(modifiers),
      normalizedModelId: extracted.normalizedModelId,
      source: extracted.source,
    };
  }

  const nanoBananaMatch = NANO_BANANA_MODEL_PATTERN.exec(extracted.normalizedModelId);
  if (nanoBananaMatch) {
    const [, modifiers] = nanoBananaMatch;

    return {
      family: 'nanoBanana',
      modifiers: parseModifiers(modifiers),
      normalizedModelId: extracted.normalizedModelId,
      source: extracted.source,
    };
  }
};

const hasModifier = (parsed: ParsedGoogleModelId, modifier: string): boolean =>
  parsed.modifiers.includes(modifier);

const hasVersionAtLeast = (
  parsed: ParsedGoogleModelId,
  majorVersion: number,
  minorVersion = 0,
): boolean => {
  if (parsed.majorVersion === undefined) return false;
  if (parsed.majorVersion > majorVersion) return true;
  if (parsed.majorVersion < majorVersion) return false;

  return (parsed.minorVersion ?? 0) >= minorVersion;
};

export const isGeminiVersionAtLeast = (
  model: string | undefined,
  majorVersion: number,
  minorVersion = 0,
): boolean => {
  if (!model) return false;

  const parsed = parseGoogleModelId(model);
  return (
    !!parsed && parsed.family === 'gemini' && hasVersionAtLeast(parsed, majorVersion, minorVersion)
  );
};

export const isGemini3OrAbove = (model?: string): boolean => isGeminiVersionAtLeast(model, 3);

export const isGoogleSafetyOffModel = (model: string): boolean => {
  const normalizedModelId = normalizeGoogleModelId(model);
  return !!normalizedModelId && SAFETY_OFF_MODELS.has(normalizedModelId);
};

export const isGoogleImageResponseModel = (model: string): boolean => {
  const normalizedModelId = normalizeGoogleModelId(model);
  if (!normalizedModelId) return false;
  if (IMAGE_RESPONSE_MODEL_ALIASES.has(normalizedModelId)) return true;

  const parsed = parseGoogleModelId(model);
  if (!parsed) return false;

  // Every Nano Banana model is a native image-output model and needs
  // `responseModalities: ['Text', 'Image']`. Without it Vertex/Gemini returns
  // the generated image as base64 *text* instead of an inlineData part, which
  // bypasses the upload pipeline and blows up the context. The family check
  // below only matches `gemini-*-image` ids, so nanoBanana-family aliases
  // (e.g. `nano-banana-lite`) must be recognized explicitly — mirroring why
  // `nano-banana-pro-preview` was pinned into IMAGE_RESPONSE_MODEL_ALIASES.
  if (parsed.family === 'nanoBanana') return true;

  return (
    parsed.family === 'gemini' &&
    hasModifier(parsed, 'image') &&
    (hasModifier(parsed, 'flash') || hasModifier(parsed, 'pro'))
  );
};

export const isGoogleNanoBananaModel = (model: string | undefined): boolean => {
  if (!model) return false;

  const aliasModelId = normalizeGoogleModelIdForAlias(model);
  if (!aliasModelId) return false;
  if (NANO_BANANA_MODEL_ALIASES.has(aliasModelId)) return true;

  return parseGoogleModelId(model)?.family === 'nanoBanana';
};

export const shouldUseGoogleImageSearchTypes = (model: string): boolean => {
  const normalizedModelId = normalizeGoogleModelId(model);
  return !!normalizedModelId && IMAGE_SEARCH_TYPES_MODELS.has(normalizedModelId);
};

export const supportsGoogleSearchOnImageResponseModel = (model: string): boolean => {
  const parsed = parseGoogleModelId(model);
  if (!parsed || parsed.family !== 'gemini') return false;

  return isGoogleImageResponseModel(model) && hasVersionAtLeast(parsed, 3);
};

export const shouldDisableGoogleSystemInstruction = (model: string): boolean => {
  const normalizedModelId = normalizeGoogleModelId(model);
  if (!normalizedModelId) return false;
  if (SYSTEM_INSTRUCTION_DISABLED_MODELS.has(normalizedModelId)) return true;
  if (/^gemma-3n?(?:[-.:]|$)/.test(normalizedModelId)) return true;

  const parsed = parseGoogleModelId(model);
  if (!parsed) return false;

  return parsed.source === 'googlePrefixed' && isGoogleImageResponseModel(model);
};

export const shouldDisableGoogleThinkingConfig = (model: string): boolean => {
  const parsed = parseGoogleModelId(model);

  return shouldDisableGoogleSystemInstruction(model) || parsed?.family === 'learnlm';
};
