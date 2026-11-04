import type { Simplify } from 'type-fest';
import { z } from 'zod';

/**
 * Audio container formats a TTS model can return. Providers map these onto their own
 * request field (`response_format` for OpenAI, `audio_setting.format` for MiniMax, ...).
 */
export const TTS_AUDIO_FORMATS = ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'] as const;

export type TTSAudioFormat = (typeof TTS_AUDIO_FORMATS)[number];

export const DEFAULT_TTS_AUDIO_FORMAT: TTSAudioFormat = 'mp3';

export const TTS_AUDIO_MIME_TYPES: Record<TTSAudioFormat, string> = {
  aac: 'audio/aac',
  flac: 'audio/flac',
  mp3: 'audio/mpeg',
  opus: 'audio/opus',
  pcm: 'audio/pcm',
  wav: 'audio/wav',
};

const numberRangeParamSchema = z.object({
  default: z.number(),
  description: z.string().optional(),
  max: z.number(),
  min: z.number(),
  step: z.number().optional(),
  type: z.literal('number').optional(),
});

const enumParamSchema = <T extends z.ZodTypeAny>(value: T) =>
  z.object({
    default: value,
    description: z.string().optional(),
    enum: z.array(value),
  });

/**
 * Declares which standard TTS parameters a model accepts and their allowed values.
 * A key that is absent means the model does not support that parameter.
 */
export const TTSModelParamsMetaSchema = z.object({
  /**
   * Default voice id; the full catalog lives on `AITTSModelCard.voices`.
   */
  voice: z
    .object({
      default: z.string(),
      description: z.string().optional(),
      type: z.literal('string').optional(),
    })
    .optional(),

  /** Playback speed multiplier, 1 is normal speed. */
  speed: numberRangeParamSchema.optional(),

  /** Pitch shift; the unit is provider-specific (semitones for MiniMax). */
  pitch: numberRangeParamSchema.optional(),

  /** Output loudness; the unit is provider-specific. */
  volume: numberRangeParamSchema.optional(),

  emotion: enumParamSchema(z.string())
    .extend({ type: z.literal('string').optional() })
    .optional(),

  format: enumParamSchema(z.enum(TTS_AUDIO_FORMATS))
    .extend({ type: z.literal('string').optional() })
    .optional(),

  /** Output sample rate in Hz. */
  sampleRate: enumParamSchema(z.number())
    .extend({ type: z.literal('number').optional() })
    .optional(),

  /** Free-form style instructions (e.g. "speak cheerfully"), for models that accept them. */
  instructions: z
    .object({
      default: z.string().optional().default(''),
      description: z.string().optional(),
      maxLength: z.number().optional(),
      type: z.literal('string').optional(),
    })
    .optional(),
});

export type TTSModelParamsSchema = z.input<typeof TTSModelParamsMetaSchema>;
export type TTSModelParamsOutputSchema = z.output<typeof TTSModelParamsMetaSchema>;
export type TTSModelParamsKeys = Simplify<keyof TTSModelParamsOutputSchema>;

/**
 * Standard TTS parameters sent to the runtime. `voice` is a top-level payload field,
 * so it is not part of `params`.
 */
export interface RuntimeTTSParams {
  emotion?: string;
  format?: TTSAudioFormat;
  instructions?: string;
  pitch?: number;
  sampleRate?: number;
  speed?: number;
  volume?: number;
}

export type RuntimeTTSParamsKeys = keyof RuntimeTTSParams;

export const TTSVoiceGenderSchema = z.enum(['female', 'male', 'neutral']);

export type TTSVoiceGender = z.infer<typeof TTSVoiceGenderSchema>;

export const TTSVoiceSchema = z.object({
  /** Short description of the timbre, e.g. "warm, calm narrator". */
  description: z.string().optional(),
  displayName: z.string(),
  gender: TTSVoiceGenderSchema,
  /** Provider voice id sent as `payload.voice`. */
  id: z.string(),
  /** BCP 47 language tag the voice is tuned for (`zh-CN`, `en-US`), or `multilingual`. */
  language: z.string(),
  previewUrl: z.string().optional(),
});

export type TTSVoice = z.infer<typeof TTSVoiceSchema>;

export function validateTTSModelParamsSchema(paramsSchema: unknown): TTSModelParamsOutputSchema {
  return TTSModelParamsMetaSchema.parse(paramsSchema);
}

/**
 * Extract the default value of every declared parameter, excluding `voice`.
 */
export function extractTTSDefaultValues(paramsSchema: TTSModelParamsSchema): RuntimeTTSParams {
  const { voice: _voice, ...schemaWithDefault } = TTSModelParamsMetaSchema.parse(paramsSchema);

  return Object.fromEntries(
    Object.entries(schemaWithDefault)
      .filter(([, value]) => value !== undefined && value.default !== undefined)
      .map(([key, value]) => [key, value!.default]),
  ) as RuntimeTTSParams;
}

export type TTSParamsIssue = { key: RuntimeTTSParamsKeys; reason: string };

/**
 * Check requested params against a model's declared schema. Returns one issue per
 * unsupported key or out-of-range value; an empty array means the request is valid.
 */
export function validateTTSParams(
  paramsSchema: TTSModelParamsSchema,
  params: RuntimeTTSParams,
): TTSParamsIssue[] {
  const schema = TTSModelParamsMetaSchema.parse(paramsSchema);
  const issues: TTSParamsIssue[] = [];

  for (const [rawKey, value] of Object.entries(params)) {
    const key = rawKey as RuntimeTTSParamsKeys;
    if (value === undefined) continue;

    const definition = schema[key];
    if (!definition) {
      issues.push({ key, reason: 'not supported by this model' });
      continue;
    }

    if ('enum' in definition && !(definition.enum as unknown[]).includes(value)) {
      issues.push({ key, reason: `must be one of ${definition.enum.join(', ')}` });
      continue;
    }

    if ('min' in definition && typeof value === 'number') {
      if (value < definition.min || value > definition.max) {
        issues.push({ key, reason: `must be between ${definition.min} and ${definition.max}` });
      }
      continue;
    }

    if (
      'maxLength' in definition &&
      typeof definition.maxLength === 'number' &&
      typeof value === 'string' &&
      value.length > definition.maxLength
    ) {
      issues.push({ key, reason: `must be at most ${definition.maxLength} characters` });
    }
  }

  return issues;
}
