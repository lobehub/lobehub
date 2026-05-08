import type { Simplify } from 'type-fest';
import { z } from 'zod';

export const MAX_VIDEO_SEED = 2 ** 32 - 1;

export const PRESET_VIDEO_SIZES = [
  '720x1280', // Portrait (default)
  '1280x720', // Landscape
  '1024x1792', // Portrait large
  '1792x1024', // Landscape large
];

export const PRESET_VIDEO_ASPECT_RATIOS = [
  '16:9', // Landscape video standard
  '9:16', // Portrait/short-form video
  '1:1', // Square
  '4:3', // Traditional
  '3:4', // Portrait traditional
  '21:9', // Ultra-wide cinematic
];

export const PRESET_VIDEO_RESOLUTIONS = ['480p', '720p', '1080p'];

export const VideoModelParamsMetaSchema = z.object({
  prompt: z.object({
    default: z.string().optional().default(''),
    description: z.string().optional(),
    type: z.literal('string').optional(),
  }),

  imageUrl: z
    .object({
      /** Aspect ratio (width/height) constraints */
      aspectRatio: z.object({ max: z.number().optional(), min: z.number().optional() }).optional(),
      default: z.string().nullable().optional(),
      description: z.string().optional(),
      height: z.object({ max: z.number().optional(), min: z.number().optional() }).optional(),
      maxFileSize: z.number().optional(),
      type: z.tuple([z.literal('string'), z.literal('null')]).optional(),
      width: z.object({ max: z.number().optional(), min: z.number().optional() }).optional(),
    })
    .optional(),

  imageUrls: z
    .object({
      /** Aspect ratio (width/height) constraints */
      aspectRatio: z.object({ max: z.number().optional(), min: z.number().optional() }).optional(),
      default: z.array(z.string()),
      description: z.string().optional(),
      height: z.object({ max: z.number().optional(), min: z.number().optional() }).optional(),
      maxCount: z.number().optional(),
      maxFileSize: z.number().optional(),
      type: z.literal('array').optional(),
      width: z.object({ max: z.number().optional(), min: z.number().optional() }).optional(),
    })
    .optional(),

  endImageUrl: z
    .object({
      /** Aspect ratio (width/height) constraints */
      aspectRatio: z.object({ max: z.number().optional(), min: z.number().optional() }).optional(),
      default: z.string().nullable().optional(),
      description: z.string().optional(),
      height: z.object({ max: z.number().optional(), min: z.number().optional() }).optional(),
      maxFileSize: z.number().optional(),
      requiresImageUrl: z.boolean().optional(),
      type: z.tuple([z.literal('string'), z.literal('null')]).optional(),
      width: z.object({ max: z.number().optional(), min: z.number().optional() }).optional(),
    })
    .optional(),

  aspectRatio: z
    .object({
      default: z.string(),
      description: z.string().optional(),
      enum: z.array(z.string()),
      type: z.literal('string').optional(),
    })
    .optional(),

  resolution: z
    .object({
      default: z.string(),
      description: z.string().optional(),
      enum: z.array(z.string()),
      type: z.literal('string').optional(),
    })
    .optional(),

  size: z
    .object({
      default: z.string(),
      description: z.string().optional(),
      enum: z.array(z.string()),
      type: z.literal('string').optional(),
    })
    .optional(),

  duration: z
    .object({
      default: z.number(),
      description: z.string().optional(),
      enum: z.array(z.number()).optional(),
      max: z.number().optional(),
      min: z.number().optional(),
      step: z.number().optional().default(1),
      type: z.literal('number').optional(),
    })
    .optional(),

  cameraFixed: z
    .object({
      default: z.boolean().default(false),
      description: z.string().optional(),
      type: z.literal('boolean').optional(),
    })
    .optional(),

  generateAudio: z
    .object({
      default: z.boolean().default(true),
      description: z.string().optional(),
      type: z.literal('boolean').optional(),
    })
    .optional(),

  promptExtend: z
    .object({
      default: z.union([z.boolean(), z.string()]),
      description: z.string().optional(),
      enum: z.array(z.string()).optional(),
      type: z.union([z.literal('boolean'), z.literal('string')]).optional(),
    })
    .optional(),

  watermark: z
    .object({
      default: z.boolean().default(false),
      description: z.string().optional(),
      type: z.literal('boolean').optional(),
    })
    .optional(),

  webSearch: z
    .object({
      default: z.boolean().default(true),
      description: z.string().optional(),
      type: z.literal('boolean').optional(),
    })
    .optional(),

  seed: z
    .object({
      default: z.number().nullable().default(null),
      description: z.string().optional(),
      max: z.number().optional().default(MAX_VIDEO_SEED),
      min: z.number().optional().default(-1),
      type: z.tuple([z.literal('number'), z.literal('null')]).optional(),
    })
    .optional(),
});

export type VideoModelParamsSchema = z.input<typeof VideoModelParamsMetaSchema>;
export type VideoModelParamsOutputSchema = z.output<typeof VideoModelParamsMetaSchema>;
export type VideoModelParamsKeys = Simplify<keyof VideoModelParamsOutputSchema>;

type VideoTypeMapping<T> = T extends 'string'
  ? string
  : T extends 'number'
    ? number
    : T extends ['number', 'null']
      ? number | null
      : T extends ['string', 'null']
        ? string | null
        : T extends 'boolean'
          ? boolean
          : never;

type VideoTypeType<K extends VideoModelParamsKeys> = NonNullable<
  VideoModelParamsOutputSchema[K]
>['type'];
type VideoDefaultType<K extends VideoModelParamsKeys> = NonNullable<
  VideoModelParamsOutputSchema[K]
>['default'];
type _StandardVideoGenerationParameters<P extends VideoModelParamsKeys = VideoModelParamsKeys> = {
  [key in P]: NonNullable<VideoTypeType<key>> extends 'array'
    ? VideoDefaultType<key>
    : VideoTypeMapping<VideoTypeType<key>>;
};

export type RuntimeVideoGenParams = Pick<_StandardVideoGenerationParameters, 'prompt'> &
  Partial<Omit<_StandardVideoGenerationParameters, 'prompt'>>;
export type RuntimeVideoGenParamsKeys = keyof RuntimeVideoGenParams;
export type RuntimeVideoGenParamsValue = RuntimeVideoGenParams[RuntimeVideoGenParamsKeys];

export function validateVideoModelParamsSchema(
  paramsSchema: unknown,
): VideoModelParamsOutputSchema {
  return VideoModelParamsMetaSchema.parse(paramsSchema);
}

/**
 * Extract default values from video parameter definition object
 */
export function extractVideoDefaultValues(paramsSchema: VideoModelParamsSchema) {
  const schemaWithDefault = VideoModelParamsMetaSchema.parse(paramsSchema);
  return Object.fromEntries(
    Object.entries(schemaWithDefault).map(([key, value]) => {
      return [key, value.default];
    }),
  ) as RuntimeVideoGenParams;
}
