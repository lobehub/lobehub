import { CREDITS_PER_DOLLAR, USD_TO_CNY } from '@lobechat/const/currency';
import debug from 'debug';
import type { FixedPricingUnit, LookupPricingUnit, Pricing } from 'model-bank';

const log = debug('lobe-cost:computeVideoCost');

export interface VideoGenerationParams {
  [key: string]: unknown;
  /** Requested output duration in seconds, required by per-second pricing */
  duration?: number;
  generateAudio?: boolean;
  resolution?: string;
}

export interface VideoCostResult {
  breakdown?: {
    completionTokens: number;
    /** Billed output seconds, set when the model is priced per second */
    durationSeconds?: number;
    lookupKey?: string;
    pricePerMillionTokens?: number;
    pricePerSecond?: number;
  };
  totalCost: number; // Total cost in USD
  totalCredits: number; // Total credits (USD * CREDITS_PER_DOLLAR)
}

const toUSD = (cost: number, currency: string) => (currency === 'CNY' ? cost / USD_TO_CNY : cost);

const resolveLookupRate = (
  unit: LookupPricingUnit,
  params: VideoGenerationParams,
): { lookupKey: string; rate: number } | undefined => {
  if (!unit.lookup?.pricingParams) {
    log('No pricing params defined for lookup strategy');
    return undefined;
  }

  const lookupParams: string[] = [];
  for (const paramName of unit.lookup.pricingParams) {
    const paramValue = params[paramName];
    if (paramValue === undefined || paramValue === null) {
      log(`Missing required lookup param: ${paramName}`);
      return undefined;
    }
    lookupParams.push(String(paramValue));
  }

  const lookupKey = lookupParams.join('_');
  const rate = unit.lookup.prices?.[lookupKey];
  if (typeof rate !== 'number') {
    log(`No price found for lookup key: ${lookupKey}`);
    return undefined;
  }

  return { lookupKey, rate };
};

/**
 * Whether the model bills video by requested output seconds instead of provider-reported tokens.
 */
export const isDurationPricedVideo = (pricing?: Pricing): boolean =>
  pricing?.units.find((unit) => unit.name === 'videoGeneration')?.unit === 'second';

/**
 * Compute the cost of a video priced per output second (e.g. fal H3 Max), where the provider
 * bills the requested `duration` at a rate that may depend on other params such as `resolution`.
 * The request params fully determine the charge, so this is exact before the video exists.
 */
export const computeVideoDurationCost = (
  pricing: Pricing,
  params: VideoGenerationParams,
): VideoCostResult | undefined => {
  const videoGenUnit = pricing.units.find((unit) => unit.name === 'videoGeneration');
  if (videoGenUnit?.unit !== 'second') return undefined;

  const duration = Number(params.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    log('Missing duration for per-second video pricing');
    return undefined;
  }

  let pricePerSecond: number;
  let lookupKey: string | undefined;
  switch (videoGenUnit.strategy) {
    case 'fixed': {
      pricePerSecond = (videoGenUnit as FixedPricingUnit).rate;
      break;
    }
    case 'lookup': {
      const resolved = resolveLookupRate(videoGenUnit as LookupPricingUnit, params);
      if (!resolved) return undefined;

      ({ lookupKey, rate: pricePerSecond } = resolved);
      break;
    }
    default: {
      log(`Unsupported pricing strategy for per-second video: ${videoGenUnit.strategy}`);
      return undefined;
    }
  }

  const currency = pricing.currency || 'USD';
  const costInUSD = toUSD(pricePerSecond * duration, currency);
  log(
    `Video cost: %d s × %d/%s per second = $%d USD`,
    duration,
    pricePerSecond,
    currency,
    costInUSD,
  );

  return {
    breakdown: {
      completionTokens: 0,
      durationSeconds: duration,
      lookupKey,
      pricePerSecond,
    },
    totalCost: costInUSD,
    totalCredits: Math.ceil(costInUSD * CREDITS_PER_DOLLAR),
  };
};

/**
 * Compute the cost for video generation based on pricing configuration.
 * Supports both fixed and lookup pricing strategies; per-second units price `params.duration`
 * and ignore `completionTokens`.
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

  if (videoGenUnit.unit === 'second') return computeVideoDurationCost(pricing, params);

  const currency = pricing.currency || 'USD';
  let pricePerMillionTokens: number;
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
      const resolved = resolveLookupRate(videoGenUnit as LookupPricingUnit, params);
      if (!resolved) return undefined;

      ({ lookupKey, rate: pricePerMillionTokens } = resolved);
      log(
        `Lookup pricing for key "${lookupKey}": ${pricePerMillionTokens} per million tokens (${currency})`,
      );
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
  const costInUSD = toUSD(costInCurrency, currency);
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
