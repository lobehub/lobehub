/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
import type { Simplify } from 'type-fest';
import { z } from 'zod';

export const MAX_SEED = 2 ** 31 - 1;

/**
 * Default aspect ratio, used when the model doesn't support native aspect ratio
 */
export const DEFAULT_ASPECT_RATIO = '1:1';

export const PRESET_ASPECT_RATIOS = [
  DEFAULT_ASPECT_RATIO, // '1:1' - Square, most commonly used
  '16:9', // Modern monitors/TVs/video standard
  '9:16', // Mobile portrait/short videos
  '4:3', // Traditional monitors/photos
  '3:4', // Traditional portrait photos
  '3:2', // Classic photo ratio landscape
  '2:3', // Classic photo ratio portrait
];

/**
 * Image generation and processing configuration constants
 */
export const IMAGE_GENERATION_CONFIG = {
  /**
   * Maximum cover image size in pixels (longest edge)
   * Used for generating cover images from source images
   */
  COVER_MAX_SIZE: 256,

  /**
   * Maximum thumbnail size in pixels (longest edge)
   * Used for generating thumbnail images from original images
   */
  THUMBNAIL_MAX_SIZE: 512,
} as const;

/**
 * Default dimension constraints for image upload auto-setting
 * Used when model schema doesn't provide min/max values
 */
export const DEFAULT_DIMENSION_CONSTRAINTS = {
  MAX_SIZE: 1024,
  MIN_SIZE: 512,
} as const;

export const CHAT_MODEL_IMAGE_GENERATION_PARAMS: ModelParamsSchema = {
  imageUrls: {
    default: [],
  },
  prompt: { default: '' },
};

// Define top-level meta specification - flat structure
export const ModelParamsMetaSchema = z.object({
  /**
   * Prompt is the only parameter that every model has
   */
  prompt: z.object({
    default: z.string().optional().default(''),
    description: z.string().optional(),
    type: z.literal('string').optional(),
  }),

  imageUrl: z
    .object({
      default: z.string().nullable().optional(),
      description: z.string().optional(),
      maxFileSize: z.number().optional(),
      type: z.tuple([z.literal('string'), z.literal('null')]).optional(),
    })
    .optional(),

  imageUrls: z
    .object({
      default: z.array(z.string()),
      description: z.string().optional(),
      maxCount: z.number().optional(),
      /**
       * The maximum file size in bytes
       */
      maxFileSize: z.number().optional(),
      type: z.literal('array').optional(),
    })
    .optional(),

  width: z
    .object({
      default: z.number(),
      description: z.string().optional(),
      max: z.number(),
      min: z.number(),
      step: z.number().optional().default(1),
      type: z.literal('number').optional(),
    })
    .optional(),

  /**
   * samplerName is not requires by all i2i providers
   */
  samplerName: z
    .object({
      default: z.string(),
      description: z.string().optional(),
      enum: z.array(z.string()).optional(),
      type: z.literal('string').optional(),
    })
    .optional(),

  /**
   * scheduler is not requires by all i2i providers
   */
  scheduler: z
    .object({
      default: z.string(),
      description: z.string().optional(),
      enum: z.array(z.string()).optional(),
      type: z.literal('string').optional(),
    })
    .optional(),

  height: z
    .object({
      default: z.number(),
      description: z.string().optional(),
      max: z.number(),
      min: z.number(),
      step: z.number().optional().default(1),
      type: z.literal('number').optional(),
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

  cfg: z
    .object({
      default: z.number(),
      description: z.string().optional(),
      max: z.number(),
      min: z.number(),
      step: z.number(),
      type: z.literal('number').optional(),
    })
    .optional(),

  /**
   * strength/denoise is optional for t2i but must be used for i2i
   */
  strength: z
    .object({
      default: z.number(),
      description: z.string().optional(),
      max: z.number().optional().default(1),
      min: z.number().optional().default(0),
      step: z.number().optional().default(0.05),
      type: z.literal('number').optional(),
    })
    .optional(),

  steps: z
    .object({
      default: z.number(),
      description: z.string().optional(),
      max: z.number(),
      min: z.number(),
      step: z.number().optional().default(1),
      type: z.literal('number').optional(),
    })
    .optional(),

  quality: z
    .object({
      default: z.string(),
      description: z.string().optional(),
      enum: z.array(z.string()),
      type: z.literal('string').optional(),
    })
    .optional(),

  seed: z
    .object({
      default: z.number().nullable().default(null),
      description: z.string().optional(),
      max: z.number().optional().default(MAX_SEED),
      min: z.number().optional().default(0),
      type: z.tuple([z.literal('number'), z.literal('null')]).optional(),
    })
    .optional(),
});
// Export inferred type for use in defining objects
export type ModelParamsSchema = z.input<typeof ModelParamsMetaSchema>;
export type ModelParamsOutputSchema = z.output<typeof ModelParamsMetaSchema>;
export type ModelParamsKeys = Simplify<keyof ModelParamsOutputSchema>;

type TypeMapping<T> = T extends 'string'
  ? string
  : T extends 'number'
    ? number
    : T extends ['number', 'null']
      ? number | null
      : T extends ['string', 'null']
        ? string | null
        : T extends 'string'
          ? string
          : T extends 'boolean'
            ? boolean
            : never;
type TypeType<K extends ModelParamsKeys> = NonNullable<ModelParamsOutputSchema[K]>['type'];
type DefaultType<K extends ModelParamsKeys> = NonNullable<ModelParamsOutputSchema[K]>['default'];
type _StandardImageGenerationParameters<P extends ModelParamsKeys = ModelParamsKeys> = {
  [key in P]: NonNullable<TypeType<key>> extends 'array'
    ? DefaultType<key>
    : TypeMapping<TypeType<key>>;
};

export type RuntimeImageGenParams = Pick<_StandardImageGenerationParameters, 'prompt'> &
  Partial<Omit<_StandardImageGenerationParameters, 'prompt'>>;
export type RuntimeImageGenParamsKeys = keyof RuntimeImageGenParams;
export type RuntimeImageGenParamsValue = RuntimeImageGenParams[RuntimeImageGenParamsKeys];

// Validation function
export function validateModelParamsSchema(paramsSchema: unknown): ModelParamsOutputSchema {
  return ModelParamsMetaSchema.parse(paramsSchema);
}

/**
 * Extract default values from parameter definition object
 */
export function extractDefaultValues(paramsSchema: ModelParamsSchema) {
  // Some default values are obtained from ModelParamsMetaSchema
  const schemaWithDefault = ModelParamsMetaSchema.parse(paramsSchema);
  return Object.fromEntries(
    Object.entries(schemaWithDefault).map(([key, value]) => {
      return [key, value.default];
    }),
  ) as RuntimeImageGenParams;
}

export * from './video';
