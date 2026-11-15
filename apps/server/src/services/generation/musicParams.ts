import type { MusicGenerationParams } from '@lobechat/model-runtime';
import type { MusicModelParamsSchema } from 'model-bank';
import { MUSIC_AUDIO_FORMATS } from 'model-bank/standardParameters';
import { z } from 'zod';

/** Hard caps that hold for every provider; a model card can only narrow them. */
const MAX_PROMPT_LENGTH = 5000;
const MAX_LYRICS_LENGTH = 10_000;
const MAX_SHORT_TEXT_LENGTH = 1000;

/**
 * Standard music params accepted by `music.createMusic`. Unknown keys are rejected so a typo
 * (e.g. `lyric`) fails loudly instead of being dropped.
 */
export const musicParamsInputSchema = z
  .object({
    autoLyrics: z.boolean().optional(),
    bitrate: z.number().int().positive().optional(),
    duration: z.number().positive().nullish(),
    format: z.enum(MUSIC_AUDIO_FORMATS).optional(),
    instrumental: z.boolean().optional(),
    lyrics: z.string().max(MAX_LYRICS_LENGTH).nullish(),
    negativeStyle: z.string().max(MAX_SHORT_TEXT_LENGTH).nullish(),
    prompt: z.string().max(MAX_PROMPT_LENGTH).default(''),
    referenceAudioUrl: z.string().url().nullish(),
    sampleRate: z.number().int().positive().optional(),
    style: z.string().max(MAX_SHORT_TEXT_LENGTH).nullish(),
    title: z.string().max(MAX_SHORT_TEXT_LENGTH).nullish(),
  })
  .strict();

export type MusicParamsInput = z.infer<typeof musicParamsInputSchema>;

type MusicParamKey = keyof MusicParamsInput;

/** A value the user actually set; empty strings, `null` and `false` mean "not used". */
const isSet = (value: unknown) =>
  value !== undefined && value !== null && value !== '' && value !== false;

const hasText = (value: unknown) => typeof value === 'string' && value.trim().length > 0;

/**
 * Check params against the model card. Returns human-readable problems; an empty list means
 * the request is valid. Without a declared schema (a custom model) only the generic rules run.
 */
export const validateMusicParams = (
  params: MusicParamsInput,
  schema?: MusicModelParamsSchema,
): string[] => {
  const errors: string[] = [];

  if (
    !hasText(params.prompt) &&
    !hasText(params.lyrics) &&
    !hasText(params.style) &&
    !hasText(params.referenceAudioUrl)
  ) {
    errors.push('Provide a prompt, lyrics, style or reference audio');
  }

  if (!schema) return errors;

  for (const key of Object.keys(params) as MusicParamKey[]) {
    if (key === 'prompt' || !isSet(params[key])) continue;
    if (!(key in schema)) errors.push(`The model does not support "${key}"`);
  }

  for (const key of ['prompt', 'lyrics', 'title', 'style', 'negativeStyle'] as const) {
    const rule = schema[key];
    const value = params[key];
    if (!rule || typeof value !== 'string' || !value) continue;
    if (rule.maxLength !== undefined && value.length > rule.maxLength)
      errors.push(`"${key}" exceeds ${rule.maxLength} characters`);
    if (rule.minLength !== undefined && value.length < rule.minLength)
      errors.push(`"${key}" needs at least ${rule.minLength} characters`);
  }

  if (typeof params.duration === 'number' && schema.duration) {
    const { max, min } = schema.duration;
    if (min !== undefined && params.duration < min)
      errors.push(`"duration" must be at least ${min} seconds`);
    if (max !== undefined && params.duration > max)
      errors.push(`"duration" must be at most ${max} seconds`);
  }

  if (schema.prompt?.required && !hasText(params.prompt))
    errors.push('The model requires "prompt"');
  // An instrumental track sends no lyrics, so required lyrics only apply to a vocal one
  if (schema.lyrics?.required && !params.instrumental && !hasText(params.lyrics))
    errors.push('The model requires "lyrics"');

  if (schema.referenceAudioUrl?.required && !hasText(params.referenceAudioUrl))
    errors.push('The model requires "referenceAudioUrl"');

  if (params.format && schema.format && !schema.format.enum.includes(params.format))
    errors.push(`"format" must be one of ${schema.format.enum.join(', ')}`);
  if (params.sampleRate && schema.sampleRate && !schema.sampleRate.enum.includes(params.sampleRate))
    errors.push(`"sampleRate" must be one of ${schema.sampleRate.enum.join(', ')}`);
  if (params.bitrate && schema.bitrate && !schema.bitrate.enum.includes(params.bitrate))
    errors.push(`"bitrate" must be one of ${schema.bitrate.enum.join(', ')}`);

  return errors;
};

/**
 * Drop the params the model card does not declare. Validation lets an undeclared param through
 * while it is unset (`false`, `null`, `''`), so this keeps such values out of the stored config
 * and the provider request. Without a declared schema (a custom model) every param is kept.
 */
export const pickDeclaredMusicParams = (
  params: MusicParamsInput,
  schema?: MusicModelParamsSchema,
): MusicParamsInput => {
  if (!schema) return params;

  const result: Record<string, unknown> = { prompt: params.prompt };
  for (const [key, value] of Object.entries(params)) {
    if (key !== 'prompt' && key in schema) result[key] = value;
  }

  return result as MusicParamsInput;
};

/**
 * Map the standard params to the runtime's provider-neutral params.
 */
export const toRuntimeMusicParams = (params: MusicParamsInput): MusicGenerationParams => {
  const result: MusicGenerationParams = {};

  if (hasText(params.prompt)) result.prompt = params.prompt;
  if (hasText(params.lyrics)) result.lyrics = params.lyrics!;
  if (hasText(params.title)) result.title = params.title!;
  if (hasText(params.style)) result.style = params.style!;
  if (hasText(params.negativeStyle)) result.negativeStyle = params.negativeStyle!;
  if (hasText(params.referenceAudioUrl)) result.referenceAudioUrl = params.referenceAudioUrl!;
  if (params.instrumental !== undefined) result.instrumental = params.instrumental;
  if (params.autoLyrics !== undefined) result.lyricsOptimizer = params.autoLyrics;
  if (params.format) result.format = params.format;
  if (params.sampleRate) result.sampleRate = params.sampleRate;
  if (params.bitrate) result.bitrate = params.bitrate;
  if (typeof params.duration === 'number') result.duration = params.duration;

  return result;
};
