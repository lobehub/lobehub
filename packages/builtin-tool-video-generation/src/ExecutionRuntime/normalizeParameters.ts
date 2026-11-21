import type { VideoModelParamsSchema } from 'model-bank';
import { VideoModelParamsMetaSchema } from 'model-bank';

import type { GenerateVideoParams } from '../types';

type VideoParameters = Record<string, unknown>;

type NormalizeResult =
  { error: string; parameters?: never } | { error?: never; parameters: VideoParameters };

interface ParameterRule {
  default?: unknown;
  enum?: unknown[];
  max?: number;
  min?: number;
  step?: number;
}

/** These have dedicated tool arguments and are normalized separately. */
const DEDICATED_ARGUMENT_KEYS = new Set(['endImageUrl', 'imageUrl', 'imageUrls', 'prompt']);
const BOOLEAN_KEYS = new Set(['cameraFixed', 'generateAudio', 'watermark', 'webSearch']);
const NUMBER_KEYS = new Set(['duration', 'seed']);
const STRING_KEYS = new Set(['aspectRatio', 'resolution', 'size', 'task']);

const STANDARD_KEYS = new Set(Object.keys(VideoModelParamsMetaSchema.shape));
const GENERATION_KEYS = [...STANDARD_KEYS].filter((key) => !DEDICATED_ARGUMENT_KEYS.has(key));

const isPlainObject = (value: unknown): value is VideoParameters =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const formatKeys = (keys: string[]) => keys.map((key) => `\`${key}\``).join(', ');

/**
 * Some models send the nested `parameters` object as a JSON string. Spreading that string would
 * produce index keys and lose every value, so decode it or reject it.
 */
export const parseVideoParameters = (value: unknown): NormalizeResult => {
  if (value === undefined || value === null) return { parameters: {} };
  if (isPlainObject(value)) return { parameters: value };

  if (typeof value === 'string') {
    if (!value.trim()) return { parameters: {} };

    try {
      const parsed: unknown = JSON.parse(value);
      if (isPlainObject(parsed)) return { parameters: parsed };
    } catch {
      // Reported below with the same message as any other non-object value.
    }
  }

  return { error: '`parameters` must be a JSON object.' };
};

const coerceValue = (key: string, value: unknown): unknown => {
  if (typeof value !== 'string') return value;

  const text = value.trim();
  if (NUMBER_KEYS.has(key) && text && Number.isFinite(Number(text))) return Number(text);
  if (BOOLEAN_KEYS.has(key) && (text === 'true' || text === 'false')) return text === 'true';

  return value;
};

const validateType = (key: string, value: unknown): string | undefined => {
  if (key === 'seed' && value === null) return;
  if (NUMBER_KEYS.has(key) && (typeof value !== 'number' || !Number.isFinite(value))) {
    return `\`${key}\` must be a number.`;
  }
  if (BOOLEAN_KEYS.has(key) && typeof value !== 'boolean') return `\`${key}\` must be a boolean.`;
  if (STRING_KEYS.has(key) && typeof value !== 'string') return `\`${key}\` must be a string.`;
};

const validateAgainstRule = (key: string, value: unknown, rule: ParameterRule) => {
  if (value === null) return;

  if (rule.enum) {
    return rule.enum.includes(value)
      ? undefined
      : `\`${key}\` must be one of ${rule.enum.join(', ')}; received ${String(value)}.`;
  }

  if (typeof value !== 'number') return;

  if (rule.min !== undefined && value < rule.min) {
    return `\`${key}\` must be at least ${rule.min}; received ${value}.`;
  }
  if (rule.max !== undefined && value > rule.max) {
    return `\`${key}\` must be at most ${rule.max}; received ${value}.`;
  }
  if (key === 'duration' && (value - (rule.min ?? 0)) % (rule.step ?? 1) !== 0) {
    return `\`${key}\` must move in steps of ${rule.step ?? 1}; received ${value}.`;
  }
};

/**
 * Build the provider params for one model. Every value either reaches the request as given or
 * fails here: a value that is dropped later is replaced by the billed model default, so the user
 * would pay for a video with a different specification than the one requested.
 */
export const normalizeVideoParameters = ({
  args,
  parameters,
  schema,
}: {
  args: GenerateVideoParams;
  parameters: VideoParameters;
  schema?: VideoModelParamsSchema;
}): NormalizeResult => {
  const normalized: VideoParameters = {};
  const topLevelArgs = args as unknown as VideoParameters;

  for (const [key, value] of Object.entries(parameters)) {
    if (DEDICATED_ARGUMENT_KEYS.has(key)) {
      normalized[key] = value;
      continue;
    }
    // Strict-mode tool calls send null for optional values they leave unset.
    if (value === null && key !== 'seed') continue;
    normalized[key] = coerceValue(key, value);
  }

  // The tool schema nests these under `parameters`, but models can send them next to `prompt`.
  for (const key of GENERATION_KEYS) {
    if (topLevelArgs[key] === undefined || topLevelArgs[key] === null) continue;

    const value = coerceValue(key, topLevelArgs[key]);
    if (normalized[key] !== undefined && normalized[key] !== value) {
      return {
        error: `\`${key}\` was passed twice with different values. Set it once, inside \`parameters\`.`,
      };
    }
    normalized[key] = value;
  }

  const requestedKeys = Object.keys(normalized).filter(
    (key) => !DEDICATED_ARGUMENT_KEYS.has(key) && normalized[key] !== undefined,
  );

  // No provider reads a non-standard key, so it could only ever be dropped.
  const nonStandardKeys = requestedKeys.filter((key) => !STANDARD_KEYS.has(key));
  if (nonStandardKeys.length > 0) {
    return {
      error: `Unsupported video parameters: ${formatKeys(nonStandardKeys)}. Supported parameter names are ${formatKeys(GENERATION_KEYS)}. Call getVideoModelParameters for this model.`,
    };
  }

  for (const key of requestedKeys) {
    const error = validateType(key, normalized[key]);
    if (error) return { error };
  }

  const declaredKeys = GENERATION_KEYS.filter((key) => schema?.[key as keyof typeof schema]);
  // A schema that declares no generation parameter cannot say which ones the model rejects.
  if (!schema || declaredKeys.length === 0) return { parameters: normalized };

  const undeclaredKeys = requestedKeys.filter((key) => !declaredKeys.includes(key));
  if (undeclaredKeys.length > 0) {
    return {
      error: `This model does not support ${formatKeys(undeclaredKeys)}. Supported parameters: ${formatKeys(declaredKeys)}.`,
    };
  }

  for (const key of requestedKeys) {
    const rule = schema[key as keyof typeof schema] as ParameterRule;
    const error = validateAgainstRule(key, normalized[key], rule);
    if (error) return { error };
  }

  return { parameters: normalized };
};
