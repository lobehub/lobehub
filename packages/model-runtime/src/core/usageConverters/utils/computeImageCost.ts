import { CREDITS_PER_DOLLAR } from '@lobechat/const/currency';
import debug from 'debug';
import type { FixedPricingUnit, LookupPricingUnit, Pricing } from 'model-bank';

const log = debug('lobe-cost:computeImagePricing');

export interface ImageGenerationParams {
  // Other possible parameters for future extensions
  [key: string]: any;
  quality?: 'standard' | 'hd';
  size?: string;
}

export interface ImageCostResult {
  breakdown?: {
    imageCount: number;
    /** Number of reference images sent with each generation request */
    inputImageCount?: number;
    /** Input-image fee charged per generated image, in USD */
    inputImageCost?: number;
    lookupKey?: string;
    pricePerImage: number; // Price per image in USD
  };
  totalCost: number; // Total cost in USD
  totalCredits: number; // Total credits (USD * CREDITS_PER_DOLLAR)
}

const countInputImages = (params: ImageGenerationParams): number => {
  if (Array.isArray(params.imageUrls)) return params.imageUrls.filter(Boolean).length;
  return params.imageUrl ? 1 : 0;
};

/**
 * Compute the cost for image generation based on pricing configuration
 * @param pricing - The pricing configuration for the model
 * @param params - Image generation parameters (quality, size, etc.)
 * @param imageNum - Number of images to generate
 * @returns ImageCostResult with total cost in USD and credits, or undefined if pricing not found
 */
export const computeImageCost = (
  pricing: Pricing,
  params: ImageGenerationParams,
  imageNum: number,
): ImageCostResult | undefined => {
  // Find imageGeneration pricing unit
  const imageGenUnit = pricing.units.find((unit) => unit.name === 'imageGeneration');
  if (!imageGenUnit) {
    log('No imageGeneration unit found in pricing configuration');
    return undefined;
  }

  let pricePerImageInUSD: number;
  let lookupKey: string | undefined;

  switch (imageGenUnit.strategy) {
    case 'fixed': {
      const fixedUnit = imageGenUnit as FixedPricingUnit;
      if (fixedUnit.unit !== 'image') {
        log(`Unsupported unit type for fixed pricing: ${fixedUnit.unit}`);
        return undefined;
      }
      pricePerImageInUSD = fixedUnit.rate;
      log(`Fixed pricing: $${pricePerImageInUSD} per image`);

      break;
    }
    case 'lookup': {
      const lookupUnit = imageGenUnit as LookupPricingUnit;

      // Build lookup key from params
      const lookupParams: string[] = [];

      // Check required pricing params
      if (lookupUnit.lookup?.pricingParams) {
        for (const paramName of lookupUnit.lookup.pricingParams) {
          const paramValue = params[paramName];
          if (paramValue === undefined || paramValue === null) {
            log(`Missing required lookup param: ${paramName}`);
            return undefined;
          }
          lookupParams.push(String(paramValue));
        }
        lookupKey = lookupParams.join('_');
      } else {
        log('No pricing params defined for lookup strategy');
        return undefined;
      }

      // Find price for the lookup key
      const lookupPrice = lookupUnit.lookup?.prices?.[lookupKey];
      if (typeof lookupPrice !== 'number') {
        log(`No price found for lookup key: ${lookupKey}`);
        return undefined;
      }

      pricePerImageInUSD = lookupPrice;
      log(`Lookup pricing for key "${lookupKey}": $${pricePerImageInUSD} per image`);

      break;
    }
    case 'tiered': {
      // TODO: Implement tiered pricing when needed
      log('Tiered pricing strategy not yet implemented for image generation');
      return undefined;
    }
    default: {
      // @ts-expect-error - PricingUnit strategy may have unsupported values
      log(`Unsupported pricing strategy: ${imageGenUnit.strategy}`);
      return undefined;
    }
  }

  // Some providers (e.g. xAI image edits) also bill every reference image sent with a
  // request. Each generated image is its own upstream request carrying the same
  // references, so the input fee is added once per generated image.
  const inputImageCount = countInputImages(params);
  const inputImageUnit = pricing.units.find(
    (unit): unit is FixedPricingUnit =>
      unit.name === 'imageInput' && unit.strategy === 'fixed' && unit.unit === 'image',
  );
  const inputImageCost = inputImageUnit ? inputImageUnit.rate * inputImageCount : 0;
  if (inputImageCost > 0) {
    log(`Input image fee: ${inputImageCount} images × $${inputImageUnit!.rate}`);
  }

  // Calculate total cost in USD first, then convert to credits
  const totalCost = (pricePerImageInUSD + inputImageCost) * imageNum;
  const totalCredits = Math.ceil(totalCost * CREDITS_PER_DOLLAR);

  log(
    `Image cost calculation: ${imageNum} images × $${pricePerImageInUSD} = $${totalCost} (${totalCredits} credits)`,
  );

  return {
    breakdown: {
      imageCount: imageNum,
      ...(inputImageCost > 0 && { inputImageCost, inputImageCount }),
      lookupKey,
      pricePerImage: pricePerImageInUSD,
    },
    totalCost,
    totalCredits,
  };
};
