import { ModelParamsMetaSchema, type ModelParamsSchema, PRESET_ASPECT_RATIOS } from './index';
import { VideoModelParamsMetaSchema, type VideoModelParamsSchema } from './video';

// Deliberately not re-exported from `./index`: this module reads the parameter
// vocabulary defined there, and re-exporting it would close an import cycle.
// Consumers reach it through `model-bank/standardParameters/fromJsonSchema`.

/**
 * The subset of JSON Schema that provider input schemas actually use.
 *
 * Replicate, fal and Cloudflare all publish OpenAPI documents whose model input
 * is a flat object of scalar properties: no nesting, no composition beyond the
 * `anyOf: [T, null]` idiom their generators emit for optional fields.
 */
export interface JsonSchemaProperty {
  anyOf?: JsonSchemaProperty[];
  contentMediaType?: string;
  default?: unknown;
  description?: string;
  enum?: unknown[];
  format?: string;
  items?: JsonSchemaProperty;
  maximum?: number;
  minimum?: number;
  multipleOf?: number;
  title?: string;
  type?: string | string[];
}

export interface JsonSchemaObject {
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  type?: string | string[];
}

export type InferredModality = 'image' | 'video';

/**
 * Provider input names that map onto a standard parameter, most specific first.
 *
 * The standard parameter vocabulary is closed, so this table is the whole of
 * the mapping: an input with no entry here has nowhere to go and is reported as
 * unmapped rather than silently dropped.
 */
const IMAGE_ALIASES: Record<string, string[]> = {
  aspectRatio: ['aspect_ratio', 'aspectRatio', 'image_ratio'],
  cfg: ['cfg', 'cfg_scale', 'guidance', 'guidance_scale'],
  height: ['height', 'image_height'],
  imageUrl: ['image', 'image_url', 'input_image', 'init_image'],
  imageUrls: ['images', 'image_urls', 'input_images', 'reference_images'],
  prompt: ['prompt', 'text_prompt'],
  quality: ['quality', 'output_quality'],
  resolution: ['resolution', 'output_resolution'],
  samplerName: ['sampler', 'sampler_name'],
  scheduler: ['scheduler'],
  seed: ['seed'],
  size: ['size', 'image_size'],
  steps: ['steps', 'num_inference_steps', 'num_steps'],
  strength: ['strength', 'denoise', 'denoising_strength', 'image_strength'],
  watermark: ['watermark', 'add_watermark'],
  width: ['width', 'image_width'],
};

const VIDEO_ALIASES: Record<string, string[]> = {
  aspectRatio: ['aspect_ratio', 'aspectRatio'],
  cameraFixed: ['camera_fixed', 'static_camera'],
  duration: ['duration', 'duration_seconds', 'video_length'],
  endImageUrl: ['last_frame_image', 'end_image', 'end_image_url', 'tail_image_url'],
  generateAudio: ['generate_audio', 'with_audio', 'enable_audio'],
  imageUrl: ['image', 'image_url', 'input_image', 'first_frame_image', 'start_image'],
  imageUrls: ['images', 'image_urls', 'reference_images'],
  prompt: ['prompt', 'text_prompt'],
  promptExtend: ['prompt_extend', 'prompt_optimizer', 'expand_prompt'],
  resolution: ['resolution', 'size_level'],
  seed: ['seed'],
  size: ['size'],
  watermark: ['watermark', 'add_watermark'],
};

/** Input names that only exist on video models. */
const VIDEO_ONLY_INPUTS = new Set([
  'duration',
  'duration_seconds',
  'fps',
  'frame_rate',
  'frames_per_second',
  'motion_bucket_id',
  'num_frames',
  'video_length',
]);

/** Output property names each modality is published under. */
const VIDEO_OUTPUT_KEYS = new Set(['video', 'videos', 'video_url']);
const IMAGE_OUTPUT_KEYS = new Set(['image', 'images', 'image_url']);

/**
 * Unwrap the `anyOf: [T, null]` idiom, so a nullable property is read through
 * its non-null branch.
 */
const unwrap = (property: JsonSchemaProperty): JsonSchemaProperty => {
  if (!property.anyOf?.length) return property;

  const concrete = property.anyOf.find((branch) => branch.type !== 'null');
  if (!concrete) return property;

  // The branch only carries the type: `default`, `description` and the numeric
  // bounds stay on the outer level, so the two have to be merged rather than
  // the branch simply replacing the property.
  const { anyOf: _discarded, ...outer } = property;

  return { ...outer, ...concrete };
};

const typesOf = (property: JsonSchemaProperty): string[] => {
  const { type } = property;
  if (!type) return [];
  return Array.isArray(type) ? type : [type];
};

/**
 * Resolve a standard parameter to the provider input backing it.
 * Returns the first alias the schema actually declares.
 */
const findProperty = (
  properties: Record<string, JsonSchemaProperty>,
  aliases: string[],
): { name: string; property: JsonSchemaProperty } | undefined => {
  for (const alias of aliases) {
    const property = properties[alias];
    if (property) return { name: alias, property: unwrap(property) };
  }

  return undefined;
};

/**
 * Infer whether a model produces images or video from its API schema.
 *
 * The output schema alone is not enough on every provider: Replicate types a
 * generated video as `{ type: 'string', format: 'uri' }`, which is exactly how
 * it types a generated image. So the output is only trusted when it names the
 * medium, and the input signals decide otherwise.
 */
export function inferModality(schema: {
  input?: JsonSchemaObject;
  output?: JsonSchemaObject | JsonSchemaProperty;
}): InferredModality | undefined {
  const output = schema.output as JsonSchemaObject | undefined;

  // 1. A named output property (fal: `video` / `images`) is decisive.
  for (const name of Object.keys(output?.properties ?? {})) {
    if (VIDEO_OUTPUT_KEYS.has(name)) return 'video';
    if (IMAGE_OUTPUT_KEYS.has(name)) return 'image';
  }

  // 2. Otherwise a declared media type, when the provider bothers to publish one.
  const mediaType = (output as JsonSchemaProperty | undefined)?.contentMediaType;
  if (mediaType?.startsWith('video/')) return 'video';
  if (mediaType?.startsWith('image/')) return 'image';

  const inputs = schema.input?.properties ?? {};
  const inputNames = Object.keys(inputs);

  // 3. Fall back to inputs only a video model can have.
  if (inputNames.some((name) => VIDEO_ONLY_INPUTS.has(name))) return 'video';

  // 4. An image model is only claimed on positive evidence: a prompt plus a
  //    frame-defining input. Anything else stays undecided rather than guessed.
  const hasPrompt = inputNames.some((name) => IMAGE_ALIASES.prompt.includes(name));
  const hasFraming = inputNames.some((name) =>
    ['aspect_ratio', 'height', 'image_size', 'size', 'width'].includes(name),
  );
  if (hasPrompt && hasFraming) return 'image';

  return undefined;
}

const asStringEnum = (property: JsonSchemaProperty): string[] | undefined => {
  const values = property.enum?.filter((value) => typeof value === 'string') as
    string[] | undefined;
  return values?.length ? values : undefined;
};

/**
 * Read an enum of durations as numbers.
 *
 * fal publishes them as strings (`['5', '10']`) while the standard schema types
 * `duration` as a number, so the string form has to be converted rather than
 * rejected.
 */
const asNumberEnum = (property: JsonSchemaProperty): number[] | undefined => {
  if (!property.enum?.length) return undefined;

  const values = property.enum.map((value) =>
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN,
  );

  return values.every((value) => Number.isFinite(value)) ? values : undefined;
};

const numberDefault = (property: JsonSchemaProperty, fallback: number): number => {
  if (typeof property.default === 'number') return property.default;
  if (typeof property.default === 'string' && Number.isFinite(Number(property.default))) {
    return Number(property.default);
  }
  return fallback;
};

interface ConversionResult<T> {
  parameters: T;
  /** Provider inputs with no home in the standard vocabulary. */
  unmapped: string[];
}

/**
 * Build the standard `parameters` block for a model from its provider input
 * schema.
 *
 * Every emitted entry is validated against the closed standard-parameter zod
 * schema before being returned, so a converted card cannot carry a shape the
 * runtime would later reject.
 */
export function jsonSchemaToParameters(
  input: JsonSchemaObject,
  modality: 'image',
): ConversionResult<ModelParamsSchema>;
export function jsonSchemaToParameters(
  input: JsonSchemaObject,
  modality: 'video',
): ConversionResult<VideoModelParamsSchema>;
export function jsonSchemaToParameters(
  input: JsonSchemaObject,
  modality: InferredModality,
): ConversionResult<ModelParamsSchema | VideoModelParamsSchema> {
  const properties = input.properties ?? {};
  const aliases = modality === 'video' ? VIDEO_ALIASES : IMAGE_ALIASES;

  const parameters: Record<string, unknown> = {};
  const consumed = new Set<string>();

  for (const [standardKey, candidates] of Object.entries(aliases)) {
    const found = findProperty(properties, candidates);
    if (!found) continue;

    const converted = convertProperty(standardKey, found.property);
    if (!converted) continue;

    parameters[standardKey] = converted;
    consumed.add(found.name);
  }

  const unmapped = Object.keys(properties).filter((name) => !consumed.has(name));

  // `prompt` is required by both runtime param types; a model without one is
  // not a text-driven generation model and gets an empty prompt slot.
  if (!parameters.prompt) parameters.prompt = { default: '' };

  const validated =
    modality === 'video'
      ? VideoModelParamsMetaSchema.parse(parameters)
      : ModelParamsMetaSchema.parse(parameters);

  return { parameters: validated as ModelParamsSchema | VideoModelParamsSchema, unmapped };
}

/**
 * Convert one provider input into the shape the standard schema declares for
 * that key. Returns undefined when the schema does not carry enough to build a
 * valid entry — a missing enum on `aspectRatio`, say — so the key is left off
 * rather than emitted half-formed.
 */
function convertProperty(
  standardKey: string,
  property: JsonSchemaProperty,
): Record<string, unknown> | undefined {
  const description = property.description;
  const types = typesOf(property);

  switch (standardKey) {
    case 'prompt': {
      return { default: typeof property.default === 'string' ? property.default : '', description };
    }

    // Enum-backed strings: without the enum there is no picker to render.
    case 'aspectRatio':
    case 'quality':
    case 'resolution':
    case 'size': {
      const values = asStringEnum(property);
      if (!values) return undefined;

      const fallback = standardKey === 'aspectRatio' ? PRESET_ASPECT_RATIOS[0] : values[0];
      const preferred = typeof property.default === 'string' ? property.default : undefined;

      return {
        default: preferred && values.includes(preferred) ? preferred : (values[0] ?? fallback),
        description,
        enum: values,
      };
    }

    // Free-form strings whose enum is optional.
    case 'samplerName':
    case 'scheduler': {
      const values = asStringEnum(property);
      const preferred = typeof property.default === 'string' ? property.default : undefined;
      const fallbackDefault = preferred ?? values?.[0];
      if (!fallbackDefault) return undefined;

      return { default: fallbackDefault, description, ...(values ? { enum: values } : {}) };
    }

    case 'imageUrl':
    case 'endImageUrl': {
      return { default: null, description };
    }

    case 'imageUrls': {
      return { default: [], description };
    }

    case 'duration': {
      const values = asNumberEnum(property);
      if (values) {
        const preferred = numberDefault(property, values[0]);
        return {
          default: values.includes(preferred) ? preferred : values[0],
          description,
          enum: values,
        };
      }

      if (typeof property.minimum !== 'number' && typeof property.maximum !== 'number') {
        return undefined;
      }

      const min = property.minimum ?? 1;
      return {
        default: numberDefault(property, min),
        description,
        max: property.maximum,
        min,
        step: property.multipleOf ?? 1,
      };
    }

    // Numbers the standard schema requires bounds for.
    case 'cfg':
    case 'height':
    case 'steps':
    case 'width': {
      if (typeof property.minimum !== 'number' || typeof property.maximum !== 'number') {
        return undefined;
      }

      return {
        default: numberDefault(property, property.minimum),
        description,
        max: property.maximum,
        min: property.minimum,
        step: property.multipleOf ?? (standardKey === 'cfg' ? 0.5 : 1),
      };
    }

    case 'strength': {
      return {
        default: numberDefault(property, 0.8),
        description,
        ...(typeof property.maximum === 'number' ? { max: property.maximum } : {}),
        ...(typeof property.minimum === 'number' ? { min: property.minimum } : {}),
        ...(typeof property.multipleOf === 'number' ? { step: property.multipleOf } : {}),
      };
    }

    case 'seed': {
      return {
        default: null,
        description,
        ...(typeof property.maximum === 'number' ? { max: property.maximum } : {}),
        ...(typeof property.minimum === 'number' ? { min: property.minimum } : {}),
      };
    }

    case 'promptExtend': {
      const values = asStringEnum(property);
      if (values) {
        const preferred = typeof property.default === 'string' ? property.default : undefined;
        return { default: preferred ?? values[0], description, enum: values };
      }

      return { default: property.default === true, description };
    }

    // Plain booleans.
    case 'cameraFixed':
    case 'generateAudio':
    case 'watermark': {
      if (!types.includes('boolean')) return undefined;
      return { default: property.default === true, description };
    }

    default: {
      return undefined;
    }
  }
}
