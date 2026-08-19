import { CREDITS_PER_DOLLAR, USD_TO_CNY } from '@lobechat/const/currency';
import debug from 'debug';
import type { FixedPricingUnit, LookupPricingUnit, Pricing, PricingUnit } from 'model-bank';

const log = debug('lobe-cost:computeVideoCost');

export interface VideoGenerationParams {
  [key: string]: unknown;
  duration?: number;
  generateAudio?: boolean;
  resolution?: string;
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

const lookupUnitRate = (
  unit: LookupPricingUnit,
  params: VideoGenerationParams,
): { lookupKey: string; rate: number } | undefined => {
  const lookupParams: string[] = [];
  if (!unit.lookup?.pricingParams?.length) {
    log('No pricing params defined for lookup strategy');
    return undefined;
  }

  for (const paramName of unit.lookup.pricingParams) {
    const paramValue = params[paramName];
    if (paramValue === undefined || paramValue === null) {
      log(`Missing required lookup param: ${paramName}`);
      return undefined;
    }
    lookupParams.push(String(paramValue));
  }

  const lookupKey = lookupParams.join('_');
  const lookupPrice = unit.lookup.prices?.[lookupKey];
  if (typeof lookupPrice !== 'number') {
    log(`No price found for lookup key: ${lookupKey}`);
    return undefined;
  }

  return { lookupKey, rate: lookupPrice };
};

const costFromUnitRate = (
  unitType: PricingUnit['unit'],
  rate: number,
  completionTokens: number,
  params: VideoGenerationParams,
): number | undefined => {
  switch (unitType) {
    case 'millionTokens': {
      return (rate * completionTokens) / 1_000_000;
    }
    case 'second': {
      if (typeof params.duration !== 'number' || !Number.isFinite(params.duration)) {
        log('Missing duration for per-second video pricing');
        return undefined;
      }
      return rate * params.duration;
    }
    case 'video': {
      return rate;
    }
    default: {
      log(`Unsupported unit type for video pricing: ${unitType}`);
      return undefined;
    }
  }
};

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
  let unitRate: number;
  let lookupKey: string | undefined;

  switch (videoGenUnit.strategy) {
    case 'fixed': {
      const fixedUnit = videoGenUnit as FixedPricingUnit;
      unitRate = fixedUnit.rate;
      log(`Fixed pricing: ${unitRate} per ${fixedUnit.unit} (${currency})`);
      break;
    }
    case 'lookup': {
      const resolved = lookupUnitRate(videoGenUnit as LookupPricingUnit, params);
      if (!resolved) return undefined;
      lookupKey = resolved.lookupKey;
      unitRate = resolved.rate;
      log(`Lookup pricing for key "${lookupKey}": ${unitRate} (${currency})`);
      break;
    }
    default: {
      log(`Unsupported pricing strategy: ${videoGenUnit.strategy}`);
      return undefined;
    }
  }

  const costInCurrency = costFromUnitRate(videoGenUnit.unit, unitRate, completionTokens, params);
  if (costInCurrency === undefined) return undefined;

  // Convert to USD if needed
  const costInUSD = currency === 'CNY' ? costInCurrency / USD_TO_CNY : costInCurrency;
  const totalCredits = Math.ceil(costInUSD * CREDITS_PER_DOLLAR);

  log(
    `Video cost: unit=%s rate=%d tokens=%d duration=%s → %d %s = $%d USD (%d credits)`,
    videoGenUnit.unit,
    unitRate,
    completionTokens,
    params.duration,
    costInCurrency,
    currency,
    costInUSD,
    totalCredits,
  );

  return {
    breakdown: {
      completionTokens,
      lookupKey,
      pricePerMillionTokens: videoGenUnit.unit === 'millionTokens' ? unitRate : 0,
    },
    totalCost: costInUSD,
    totalCredits,
  };
};
