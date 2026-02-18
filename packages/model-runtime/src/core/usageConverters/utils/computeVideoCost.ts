import { CREDITS_PER_DOLLAR, USD_TO_CNY } from '@lobechat/const/currency';
import debug from 'debug';
import type { FixedPricingUnit, LookupPricingUnit, Pricing } from 'model-bank';

const log = debug('lobe-cost:computeVideoCost');

export interface VideoGenerationParams {
  [key: string]: any;
  generateAudio?: boolean;
}

export interface VideoCostResult {
  breakdown?: {
    completionTokens: number;
    lookupKey?: string;
    pricePerMillionTokens: number;
  };
  totalCost: number; // Total cost in USD
  totalCredits: number; // Total credits (USD * CREDITS_PER_DOLLAR)
}

/**
 * Compute the cost for video generation based on pricing configuration.
 * Supports both fixed and lookup pricing strategies.
 * Handles CNY→USD conversion when pricing currency is CNY.
 */
export const computeVideoCost = (
  pricing: Pricing,
  completionTokens: number,
  params: VideoGenerationParams,
): VideoCostResult | undefined => {
  const videoGenUnit = pricing.units.find((unit) => unit.name === 'videoGeneration');
  if (!videoGenUnit) {
    log('No videoGeneration unit found in pricing configuration');
    return undefined;
  }

  const currency = pricing.currency || 'USD';
  let pricePerMillionTokens = 0;
  let lookupKey: string | undefined;

  switch (videoGenUnit.strategy) {
    case 'fixed': {
      const fixedUnit = videoGenUnit as FixedPricingUnit;
      if (fixedUnit.unit !== 'millionTokens') {
        log(`Unsupported unit type for fixed pricing: ${fixedUnit.unit}`);
        return undefined;
      }
      pricePerMillionTokens = fixedUnit.rate;
      log(`Fixed pricing: ${pricePerMillionTokens} per million tokens (${currency})`);
      break;
    }
    case 'lookup': {
      const lookupUnit = videoGenUnit as LookupPricingUnit;

      const lookupParams: string[] = [];
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

      const lookupPrice = lookupUnit.lookup?.prices?.[lookupKey];
      if (typeof lookupPrice !== 'number') {
        log(`No price found for lookup key: ${lookupKey}`);
        return undefined;
      }

      pricePerMillionTokens = lookupPrice;
      log(`Lookup pricing for key "${lookupKey}": ${pricePerMillionTokens} per million tokens (${currency})`);
      break;
    }
    default: {
      log(`Unsupported pricing strategy: ${videoGenUnit.strategy}`);
      return undefined;
    }
  }

  // Calculate cost in original currency
  const costInCurrency = (pricePerMillionTokens * completionTokens) / 1_000_000;

  // Convert to USD if needed
  const costInUSD = currency === 'CNY' ? costInCurrency / USD_TO_CNY : costInCurrency;
  const totalCredits = Math.ceil(costInUSD * CREDITS_PER_DOLLAR);

  log(
    `Video cost: %d tokens × %d/%s per million = %d %s = $%d USD (%d credits)`,
    completionTokens,
    pricePerMillionTokens,
    currency,
    costInCurrency,
    currency,
    costInUSD,
    totalCredits,
  );

  return {
    breakdown: {
      completionTokens,
      lookupKey,
      pricePerMillionTokens,
    },
    totalCost: costInUSD,
    totalCredits,
  };
};
