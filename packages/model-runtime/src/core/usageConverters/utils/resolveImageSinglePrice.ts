import type { Pricing } from 'model-bank';

export interface ImageSinglePriceResult {
  approximatePrice?: number;
  price?: number;
}

const DEFAULT_REFERENCE_MP = (1024 * 1024) / 1_000_000;

export const resolveImageSinglePrice = (pricing?: Pricing): ImageSinglePriceResult => {
  if (!pricing) return {};

  // Priority 1: Use approximate price if explicitly provided
  if (typeof pricing.approximatePricePerImage === 'number') {
    return { approximatePrice: pricing.approximatePricePerImage };
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

  // Lookup: show the lowest listed price as an approximate per-image amount.
  if (imageGenerationUnit.strategy === 'lookup') {
    const prices = Object.values(imageGenerationUnit.lookup.prices);
    if (prices.length === 0) return {};
    return { approximatePrice: Math.min(...prices) };
  }

  // Token-priced generators live on imageOutput, not imageGeneration.
  return {};
};
