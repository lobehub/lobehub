import type { Simplify } from 'type-fest';
import { z } from 'zod';

/**
 * Standard text-to-music parameters.
 *
 * A model card declares only the keys its provider accepts; a missing key means the model
 * does not support that parameter, so the creation UI hides it and the runtime never sends it.
 *
 * Each provider's runtime adapter maps these keys onto its own request fields:
 * - `prompt`: free-form description of the song (genre, mood, scene).
 * - `lyrics`: song lyrics, optionally with structure tags such as `[Verse]` / `[Chorus]`.
 * - `title` / `style` / `negativeStyle`: song title, style tags and styles to avoid.
 * - `instrumental`: no vocals.
 * - `autoLyrics`: let the provider write lyrics from the prompt.
 * - `duration`: target length in seconds.
 * - `referenceAudioUrl`: a reference track to cover or follow.
 * - `format` / `sampleRate` / `bitrate`: output audio settings.
 */

export const MUSIC_AUDIO_FORMATS = ['mp3', 'wav', 'pcm'] as const;
export type MusicAudioFormat = (typeof MUSIC_AUDIO_FORMATS)[number];

const stringParam = z.object({
  default: z.string().optional().default(''),
  description: z.string().optional(),
  /** Maximum length in characters */
  maxLength: z.number().optional(),
  /** Minimum length in characters */
  minLength: z.number().optional(),
  /** Whether the model cannot run without it */
  required: z.boolean().optional(),
  type: z.literal('string').optional(),
});

const nullableStringParam = z.object({
  default: z.string().nullish().default(null),
  description: z.string().optional(),
  maxLength: z.number().optional(),
  minLength: z.number().optional(),
  /** Whether the model cannot run without it */
  required: z.boolean().optional(),
  type: z.tuple([z.literal('string'), z.literal('null')]).optional(),
});

const booleanParam = z.object({
  default: z.boolean().default(false),
  description: z.string().optional(),
  type: z.literal('boolean').optional(),
});

export const MusicModelParamsMetaSchema = z.object({
  /** Style, mood or scene description. Always present. */
  prompt: stringParam,

  /** Song lyrics, one line per `\n`, with optional structure tags such as `[Verse]`. */
  lyrics: nullableStringParam.optional(),

  /** Song title. */
  title: nullableStringParam.optional(),

  /** Style or genre tags. */
  style: nullableStringParam.optional(),

  /** Styles to avoid. */
  negativeStyle: nullableStringParam.optional(),

  /** Generate music without vocals. */
  instrumental: booleanParam.optional(),

  /** Write lyrics from the prompt when `lyrics` is empty. */
  autoLyrics: booleanParam.optional(),

  /** Target length in seconds. */
  duration: z
    .object({
      default: z.number().nullable().default(null),
      description: z.string().optional(),
      max: z.number().optional(),
      min: z.number().optional(),
      step: z.number().optional().default(1),
      type: z.tuple([z.literal('number'), z.literal('null')]).optional(),
    })
    .optional(),

  /** Reference audio the model covers or follows. */
  referenceAudioUrl: z
    .object({
      default: z.string().nullish().default(null),
      description: z.string().optional(),
      /** Maximum reference length in seconds */
      maxDuration: z.number().optional(),
      /** Maximum file size in bytes */
      maxFileSize: z.number().optional(),
      /** Minimum reference length in seconds */
      minDuration: z.number().optional(),
      /** Whether the model cannot run without it */
      required: z.boolean().optional(),
      type: z.tuple([z.literal('string'), z.literal('null')]).optional(),
    })
    .optional(),

  /** Output container. */
  format: z
    .object({
      default: z.enum(MUSIC_AUDIO_FORMATS),
      description: z.string().optional(),
      enum: z.array(z.enum(MUSIC_AUDIO_FORMATS)),
      type: z.literal('string').optional(),
    })
    .optional(),

  /** Output sample rate in Hz. */
  sampleRate: z
    .object({
      default: z.number(),
      description: z.string().optional(),
      enum: z.array(z.number()),
      type: z.literal('number').optional(),
    })
    .optional(),

  /** Output bitrate in bits per second. */
  bitrate: z
    .object({
      default: z.number(),
      description: z.string().optional(),
      enum: z.array(z.number()),
      type: z.literal('number').optional(),
    })
    .optional(),
});

export type MusicModelParamsSchema = z.input<typeof MusicModelParamsMetaSchema>;
export type MusicModelParamsOutputSchema = z.output<typeof MusicModelParamsMetaSchema>;
export type MusicModelParamsKeys = Simplify<keyof MusicModelParamsOutputSchema>;

/**
 * Parameters a runtime receives for one music generation request. Only `prompt` is required.
 */
export interface RuntimeMusicGenParams {
  autoLyrics?: boolean;
  bitrate?: number;
  duration?: number | null;
  format?: MusicAudioFormat;
  instrumental?: boolean;
  lyrics?: string | null;
  negativeStyle?: string | null;
  prompt: string;
  referenceAudioUrl?: string | null;
  sampleRate?: number;
  style?: string | null;
  title?: string | null;
}
export type RuntimeMusicGenParamsKeys = keyof RuntimeMusicGenParams;

export function validateMusicModelParamsSchema(
  paramsSchema: unknown,
): MusicModelParamsOutputSchema {
  return MusicModelParamsMetaSchema.parse(paramsSchema);
}

/**
 * Extract default values from a music parameter definition object.
 */
export function extractMusicDefaultValues(paramsSchema: MusicModelParamsSchema) {
  const schemaWithDefault = MusicModelParamsMetaSchema.parse(paramsSchema);
  return Object.fromEntries(
    Object.entries(schemaWithDefault).map(([key, value]) => [key, value.default]),
  ) as unknown as RuntimeMusicGenParams;
}
