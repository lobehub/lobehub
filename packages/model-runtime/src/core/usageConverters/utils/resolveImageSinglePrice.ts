import type { Pricing, RuntimeImageGenParams } from 'model-bank';

export interface ImageSinglePriceResult {
  approximatePrice?: number;
  price?: number;
}

const DEFAULT_REFERENCE_MP = (1024 * 1024) / 1_000_000;

/**
 * Frames whose combined output tokens roughly equal one static image at default settings.
 *
 * Measured on GPT Image 2.6 Flare (2026-11-05, default quality/size): a static image used 903
 * output tokens, a 2-frame GIF 555 and a 9-frame GIF 1,172, i.e. roughly 380 + 88 × frames, though
 * a later 4-frame GIF used 974. Scaling the static price by `frames / 7` (never below one image)
 * is only an admission estimate: it can fall up to ~10% below the real cost around 6–9 frames and
 * runs high for long GIFs (about 1.4× at 64 frames). The charge always settles to reported usage.
 */
const GIF_FRAMES_PER_IMAGE_PRICE = 7;

/** Generation settings that affect the estimate; other params are accepted and ignored. */
export interface ImageSinglePriceParams {
  [key: string]: unknown;
  frameCount?: RuntimeImageGenParams['frameCount'];
  outputFormat?: RuntimeImageGenParams['outputFormat'];
}

/**
 * How many static-image prices one generation is estimated to cost: animated GIFs scale with
 * their frame count, everything else counts as one image.
 */
export const resolveImagePriceMultiplier = (params?: ImageSinglePriceParams): number => {
  if (params?.outputFormat !== 'gif' || typeof params.frameCount !== 'number') return 1;

  return Math.max(1, params.frameCount / GIF_FRAMES_PER_IMAGE_PRICE);
};

/**
 * Per-generation price of an image model. Pass the generation params to account for settings
 * that change the cost of a token-billed model, such as animated GIF frames.
 */
export const resolveImageSinglePrice = (
  pricing?: Pricing,
  params?: ImageSinglePriceParams,
): ImageSinglePriceResult => {
  if (!pricing) return {};

  // Priority 1: Use approximate price if explicitly provided
  if (typeof pricing.approximatePricePerImage === 'number') {
    return {
      approximatePrice: pricing.approximatePricePerImage * resolveImagePriceMultiplier(params),
    };
  }

  // Priority 2: Calculate exact price from pricing units
  const imageGenerationUnit = pricing.units.find((unit) => unit.name === 'imageGeneration');
  if (!imageGenerationUnit) return {};

  if (imageGenerationUnit.strategy === 'fixed') {
    if (imageGenerationUnit.unit === 'image') {
      return { price: imageGenerationUnit.rate };
    }

    if (imageGenerationUnit.unit === 'megapixel') {
      return { price: imageGenerationUnit.rate * DEFAULT_REFERENCE_MP };
    }
  }

  // Lookup/tiered pricing typically requires explicit configuration; treat as unavailable here.
  return {};
};
