import { ModelProvider } from './modelProvider';

/** The output format that produces an animated image, controlled by the frame params. */
export const ANIMATED_IMAGE_OUTPUT_FORMAT = 'gif';

/** Standard image params that only apply to animated (GIF) output. */
export const ANIMATION_FRAME_PARAMS = ['frameCount', 'frameDurationMs'] as const;

/** Static formats the OpenAI Images API (`output_format`) accepts on every route. */
const STATIC_IMAGE_OUTPUT_FORMATS = ['png', 'jpeg', 'webp'];

/**
 * Output formats a provider route can actually serve for a model, keyed by provider then model.
 * They replace the model card's `outputFormat.enum` when the card declares one, because the card
 * can describe the model in general (or come from remote config) while the route decides what
 * reaches the upstream.
 *
 * LobeHub serves GPT Image 2.6 through Images API channels that reject `output_format: "gif"`
 * with `400 Invalid option: expected one of "png"|"jpeg"|"webp"`, so the animated output OpenAI
 * documents for these models is not offered there. Remove an entry once its route serves GIF.
 */
export const IMAGE_ROUTE_OUTPUT_FORMATS: Readonly<
  Record<string, Readonly<Record<string, readonly string[]>>>
> = {
  [ModelProvider.LobeHub]: {
    'gpt-image-2.6-flare': STATIC_IMAGE_OUTPUT_FORMATS,
    'gpt-image-2.6-sunburst': STATIC_IMAGE_OUTPUT_FORMATS,
  },
};

interface OutputFormatParam {
  default?: unknown;
  enum?: unknown[];
}

/**
 * Narrow an image model's parameter schema to what its provider route can serve.
 *
 * - When the route has a registered format list and the schema declares `outputFormat`, the enum
 *   becomes that list (the default is kept when still offered, otherwise the first format).
 * - `frameCount` / `frameDurationMs` are exposed only while `gif` is an offered output format:
 *   they mean nothing for static output, and the runtime drops them there.
 *
 * Returns the input object unchanged when nothing applies, so callers can compare by reference.
 */
export const applyImageOutputCapabilities = <T extends Record<string, unknown>>(
  parameters: T | undefined,
  { model, provider }: { model: string; provider: string },
): T | undefined => {
  if (!parameters || typeof parameters !== 'object') return parameters;

  let next: Record<string, unknown> = parameters;
  const routeFormats = IMAGE_ROUTE_OUTPUT_FORMATS[provider]?.[model];
  const outputFormat = parameters.outputFormat as OutputFormatParam | undefined;

  if (routeFormats && outputFormat && typeof outputFormat === 'object') {
    const enumValues = [...routeFormats];
    next = {
      ...next,
      outputFormat: {
        ...outputFormat,
        default: enumValues.includes(outputFormat.default as string)
          ? outputFormat.default
          : enumValues[0],
        enum: enumValues,
      },
    };
  }

  const offeredFormats = (next.outputFormat as OutputFormatParam | undefined)?.enum;
  const offersAnimation =
    Array.isArray(offeredFormats) && offeredFormats.includes(ANIMATED_IMAGE_OUTPUT_FORMAT);

  if (!offersAnimation && ANIMATION_FRAME_PARAMS.some((key) => key in next)) {
    next = { ...next };
    for (const key of ANIMATION_FRAME_PARAMS) delete next[key];
  }

  return next as T;
};
