import type { ModelParamsSchema, VideoModelParamsSchema } from 'model-bank';

/**
 * Subset of an OpenAPI 3.0 schema object as fal publishes it for model inputs.
 */
export interface FalJsonSchema {
  $ref?: string;
  allOf?: FalJsonSchema[];
  anyOf?: FalJsonSchema[];
  default?: unknown;
  description?: string;
  enum?: unknown[];
  items?: FalJsonSchema;
  maximum?: number;
  maxItems?: number;
  minimum?: number;
  oneOf?: FalJsonSchema[];
  properties?: Record<string, FalJsonSchema>;
  required?: string[];
  type?: string;
}

interface FalOpenAPIDocument {
  components?: { schemas?: Record<string, FalJsonSchema> };
  paths?: Record<
    string,
    {
      post?: {
        requestBody?: { content?: Record<string, { schema?: FalJsonSchema }> };
      };
    }
  >;
}

const REF_PREFIX = '#/components/schemas/';

const resolveRef = (doc: FalOpenAPIDocument, schema: FalJsonSchema | undefined, depth = 0) => {
  let current = schema;
  while (current?.$ref && depth < 10) {
    const name = current.$ref.startsWith(REF_PREFIX) ? current.$ref.slice(REF_PREFIX.length) : '';
    const target = doc.components?.schemas?.[name];
    // Keep sibling keywords (e.g. `default`, `description`) next to the `$ref`
    const { $ref: _ref, ...siblings } = current;
    current = target ? { ...target, ...siblings } : undefined;
    depth += 1;
  }

  return current;
};

/**
 * Inline every `$ref` in a property schema, including the alternatives of `anyOf` / `oneOf` /
 * `allOf`, so callers can read enums and bounds without the OpenAPI document.
 */
const inlineSchema = (
  doc: FalOpenAPIDocument,
  schema: FalJsonSchema | undefined,
  depth = 0,
): FalJsonSchema | undefined => {
  const resolved = resolveRef(doc, schema);
  if (!resolved || depth > 4) return resolved;

  const inlineList = (list?: FalJsonSchema[]) =>
    list?.map((item) => inlineSchema(doc, item, depth + 1)).filter((item) => !!item);

  return {
    ...resolved,
    ...(resolved.anyOf && { anyOf: inlineList(resolved.anyOf) }),
    ...(resolved.oneOf && { oneOf: inlineList(resolved.oneOf) }),
    ...(resolved.allOf && { allOf: inlineList(resolved.allOf) }),
    ...(resolved.items && { items: inlineSchema(doc, resolved.items, depth + 1) }),
  };
};

/**
 * Extract the request body schema of a fal endpoint from its queue OpenAPI document. The submit
 * operation is `POST /<endpoint id>`; other POST paths (e.g. `/requests/{id}/cancel`) carry no body.
 */
export const extractFalInputSchema = (
  openapi: unknown,
  endpointId: string,
): FalJsonSchema | undefined => {
  const doc = openapi as FalOpenAPIDocument | undefined;
  if (!doc?.paths) return;

  const operations = Object.entries(doc.paths)
    .filter(([, item]) => item?.post?.requestBody)
    .sort(([path]) => (path === `/${endpointId}` ? -1 : 0));

  const bodySchema = operations[0]?.[1].post?.requestBody?.content?.['application/json']?.schema;
  const input = resolveRef(doc, bodySchema);
  if (!input?.properties) return;

  return {
    ...input,
    properties: Object.fromEntries(
      Object.entries(input.properties).map(([key, value]) => [key, inlineSchema(doc, value) ?? {}]),
    ),
  };
};

const alternativesOf = (schema: FalJsonSchema): FalJsonSchema[] => [
  schema,
  ...(schema.anyOf ?? []).flatMap(alternativesOf),
  ...(schema.oneOf ?? []).flatMap(alternativesOf),
  ...(schema.allOf ?? []).flatMap(alternativesOf),
];

/** All enum values a property accepts, across its `anyOf` / `oneOf` alternatives */
const enumOf = (schema: FalJsonSchema): unknown[] | undefined => {
  const values = alternativesOf(schema).flatMap((item) => item.enum ?? []);
  return values.length > 0 ? [...new Set(values)] : undefined;
};

const stringEnumOf = (schema: FalJsonSchema) => {
  const values = enumOf(schema)?.filter((value): value is string => typeof value === 'string');
  return values && values.length > 0 ? values : undefined;
};

const typesOf = (schema: FalJsonSchema) =>
  new Set(alternativesOf(schema).flatMap((item) => (item.type ? [item.type] : [])));

const pickEnumDefault = (values: string[], fallback: unknown, preferred: string[] = []) => {
  if (typeof fallback === 'string' && values.includes(fallback)) return fallback;
  return preferred.find((value) => values.includes(value)) ?? values[0];
};

const numberBounds = (schema: FalJsonSchema) => {
  const alternative = alternativesOf(schema).find(
    (item) => item.minimum !== undefined || item.maximum !== undefined,
  );
  return { max: alternative?.maximum, min: alternative?.minimum };
};

/**
 * Parse a fal duration enum value: fal publishes durations as `"5"`, `"10"` or `"8s"`.
 */
const parseDuration = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** fal input field each image parameter is sent as by `createImage` */
const IMAGE_PARAMETER_FIELDS: Record<string, string> = {
  aspectRatio: 'aspect_ratio',
  cfg: 'guidance_scale',
  imageUrl: 'image_url',
  imageUrls: 'image_urls',
  prompt: 'prompt',
  resolution: 'resolution',
  seed: 'seed',
  size: 'image_size',
  steps: 'num_inference_steps',
  strength: 'strength',
};

/** fal input field each video parameter is sent as by `buildGenericFalVideoInput` */
const VIDEO_PARAMETER_FIELDS: Record<string, string> = {
  aspectRatio: 'aspect_ratio',
  duration: 'duration',
  endImageUrl: 'end_image_url',
  generateAudio: 'generate_audio',
  imageUrl: 'image_url',
  imageUrls: 'image_urls',
  prompt: 'prompt',
  resolution: 'resolution',
  seed: 'seed',
};

/**
 * Whether every input the endpoint requires is one the exposed parameters send. An endpoint that
 * requires anything else (e.g. `control_image_url`) would fail fal's validation on every request.
 */
const sendsRequiredInputs = (
  required: string[] | undefined,
  parameters: Record<string, unknown>,
  fields: Record<string, string>,
) => {
  const sent = new Set(Object.keys(parameters).map((key) => fields[key]));
  return (required ?? []).every((field) => sent.has(field));
};

/**
 * Map a fal image endpoint's input schema to the image generation parameters lobehub renders.
 * Only fields the runtime knows how to send are exposed (see `createImage`'s parameter map);
 * returns undefined for endpoints without a text prompt or with a required input the runtime does
 * not send, which the generation page cannot drive.
 */
export const falInputSchemaToImageParameters = (
  input: FalJsonSchema | undefined,
): ModelParamsSchema | undefined => {
  const properties = input?.properties;
  if (!properties?.prompt) return;

  const parameters: ModelParamsSchema = { prompt: { default: '' } };

  if (properties.image_urls) {
    const maxCount = alternativesOf(properties.image_urls).find((item) => item.maxItems)?.maxItems;
    parameters.imageUrls = { default: [], ...(maxCount && { maxCount }) };
  } else if (properties.image_url) {
    parameters.imageUrl = { default: null };
  }

  const imageSizes = properties.image_size && stringEnumOf(properties.image_size);
  if (imageSizes) {
    parameters.size = {
      default: pickEnumDefault(imageSizes, properties.image_size.default, [
        'auto_2K',
        'auto',
        'square_hd',
      ]),
      enum: imageSizes,
    };
  }

  const aspectRatios = properties.aspect_ratio && stringEnumOf(properties.aspect_ratio);
  if (aspectRatios) {
    parameters.aspectRatio = {
      default: pickEnumDefault(aspectRatios, properties.aspect_ratio.default, ['1:1']),
      enum: aspectRatios,
    };
  }

  const resolutions = properties.resolution && stringEnumOf(properties.resolution);
  if (resolutions) {
    parameters.resolution = {
      default: pickEnumDefault(resolutions, properties.resolution.default),
      enum: resolutions,
    };
  }

  if (properties.num_inference_steps) {
    const { max = 50, min = 1 } = numberBounds(properties.num_inference_steps);
    const fallback = properties.num_inference_steps.default;
    parameters.steps = {
      default: typeof fallback === 'number' ? fallback : Math.min(max, Math.max(min, 28)),
      max,
      min,
      step: 1,
    };
  }

  if (properties.guidance_scale) {
    const { max = 20, min = 0 } = numberBounds(properties.guidance_scale);
    const fallback = properties.guidance_scale.default;
    parameters.cfg = {
      default: typeof fallback === 'number' ? fallback : min,
      max,
      min,
      step: 0.1,
    };
  }

  if (properties.strength) {
    const { max = 1, min = 0 } = numberBounds(properties.strength);
    const fallback = properties.strength.default;
    parameters.strength = {
      default: typeof fallback === 'number' ? fallback : max,
      max,
      min,
      step: 0.05,
    };
  }

  if (properties.seed) parameters.seed = { default: null };

  if (!sendsRequiredInputs(input?.required, parameters, IMAGE_PARAMETER_FIELDS)) return;

  return parameters;
};

/**
 * Map a fal video endpoint's input schema to the video generation parameters lobehub renders.
 * Field names follow `buildGenericFalVideoInput`, so every exposed parameter reaches fal. Returns
 * undefined for endpoints without a prompt or with a required input the runtime does not send.
 */
export const falInputSchemaToVideoParameters = (
  input: FalJsonSchema | undefined,
): VideoModelParamsSchema | undefined => {
  const properties = input?.properties;
  if (!properties?.prompt) return;

  const parameters: VideoModelParamsSchema = { prompt: { default: '' } };

  if (properties.image_url) parameters.imageUrl = { default: null };
  if (properties.end_image_url) {
    parameters.endImageUrl = {
      default: null,
      ...(properties.image_url && { requiresImageUrl: true }),
    };
  }
  if (properties.image_urls) {
    const maxCount = alternativesOf(properties.image_urls).find((item) => item.maxItems)?.maxItems;
    parameters.imageUrls = { default: [], ...(maxCount && { maxCount }) };
  }

  const aspectRatios = properties.aspect_ratio && stringEnumOf(properties.aspect_ratio);
  if (aspectRatios) {
    parameters.aspectRatio = {
      default: pickEnumDefault(aspectRatios, properties.aspect_ratio.default, ['16:9']),
      enum: aspectRatios,
    };
  }

  const resolutions = properties.resolution && stringEnumOf(properties.resolution);
  if (resolutions) {
    parameters.resolution = {
      default: pickEnumDefault(resolutions, properties.resolution.default),
      enum: resolutions,
    };
  }

  if (properties.duration) {
    const durations = enumOf(properties.duration)
      ?.map(parseDuration)
      .filter((value): value is number => value !== undefined);
    const fallback = parseDuration(properties.duration.default);

    if (durations && durations.length > 0) {
      parameters.duration = {
        default: fallback !== undefined && durations.includes(fallback) ? fallback : durations[0],
        enum: durations,
      };
    } else if (
      typesOf(properties.duration).has('integer') ||
      typesOf(properties.duration).has('number')
    ) {
      const { max, min } = numberBounds(properties.duration);
      parameters.duration = {
        default: fallback ?? min ?? 5,
        ...(max !== undefined && { max }),
        ...(min !== undefined && { min }),
        step: 1,
      };
    }
  }

  if (properties.generate_audio) {
    const fallback = properties.generate_audio.default;
    parameters.generateAudio = { default: typeof fallback === 'boolean' ? fallback : true };
  }

  if (properties.seed) parameters.seed = { default: null };

  if (!sendsRequiredInputs(input?.required, parameters, VIDEO_PARAMETER_FIELDS)) return;

  return parameters;
};

/**
 * Fit request values to the types the endpoint declares: fal takes many numeric options as string
 * enums (`duration: "5"` or `"8s"`), and rejects fields its schema does not define.
 */
export const coerceFalInput = (
  input: Record<string, unknown>,
  schema: FalJsonSchema | undefined,
) => {
  const properties = schema?.properties;
  if (!properties) return input;

  return Object.fromEntries(
    Object.entries(input).flatMap(([key, value]) => {
      const property = properties[key];
      if (!property) return [];
      if (typeof value !== 'number') return [[key, value]];

      const stringValues = stringEnumOf(property);
      if (stringValues) {
        const match = stringValues.find((item) => parseDuration(item) === value);
        return [[key, match ?? String(value)]];
      }

      const types = typesOf(property);
      if (types.has('string') && !types.has('number') && !types.has('integer')) {
        return [[key, String(value)]];
      }

      return [[key, value]];
    }),
  );
};
