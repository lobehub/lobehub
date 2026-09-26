import { CREDITS_PER_DOLLAR, USD_TO_CNY } from '@lobechat/const/currency';
import debug from 'debug';
import type { FixedPricingUnit, LookupPricingUnit, Pricing, PricingUnitType } from 'model-bank';

const log = debug('lobe-cost:computeVideoCost');

export interface VideoGenerationParams {
  [key: string]: unknown;
  /** Requested duration in seconds; the fallback quantity for second-unit pricing. */
  duration?: number;
  generateAudio?: boolean;
  resolution?: string;
}

export interface VideoCostResult {
  breakdown?: {
    completionTokens: number;
    lookupKey?: string;
    /** Populated only for `millionTokens`-unit pricing. */
    pricePerMillionTokens?: number;
    /**
     * Quantity the rate was applied to: completion tokens, seconds, or 1 for
     * per-video pricing.
     */
    quantity: number;
    /** Unit rate that was applied, in the pricing's currency. */
    rate: number;
    unit: PricingUnitType;
  };
  totalCost: number; // Total cost in USD
  totalCredits: number; // Total credits (USD * CREDITS_PER_DOLLAR)
}

/**
 * Compute the cost for video generation based on pricing configuration.
 * Supports fixed and lookup pricing strategies, honoring the pricing unit
 * (`millionTokens`, `second`, or `video`) under both strategies.
 * Handles CNY to USD conversion when pricing currency is CNY.
 */
export const computeVideoCost = (
  pricing: Pricing,
  completionTokens: number,
  params: VideoGenerationParams,
  /**
   * Actual generated duration in seconds for `second`-unit pricing; falls back
   * to `params.duration` (the requested duration) when not provided.
   */
  videoSeconds?: number,
): VideoCostResult | undefined => {
  const videoGenUnit = pricing.units.find((unit) => unit.name === 'videoGeneration');
  if (!videoGenUnit) {
    log('No videoGeneration unit found in pricing configuration');
    return undefined;
  }

  const currency = pricing.currency || 'USD';
  const unit = videoGenUnit.unit;

  // Quantity per unit type: completion tokens, seconds, or 1 video. Video
  // pricing in model-bank is dominated by `second` and `video` units;
  // `millionTokens` is the minority.
  const resolveQuantity = (): number | undefined => {
    switch (unit) {
      case 'millionTokens': {
        return completionTokens;
      }
      case 'second': {
        // Zero is not a usable duration: no video card sells zero-second
        // output, so pricing 0 as a success would report a real video as free.
        const isValidSeconds = (value: unknown): value is number =>
          typeof value === 'number' && Number.isFinite(value) && value > 0;
        const seconds = isValidSeconds(videoSeconds)
          ? videoSeconds
          : isValidSeconds(params.duration)
            ? params.duration
            : undefined;
        if (seconds === undefined) log('No usable duration for second-unit pricing');
        return seconds;
      }
      case 'video': {
        return 1;
      }
      default: {
        log(`Unsupported unit for video pricing: ${unit}`);
        return undefined;
      }
    }
  };

  let rate: number;
  let lookupKey: string | undefined;

  switch (videoGenUnit.strategy) {
    case 'fixed': {
      rate = (videoGenUnit as FixedPricingUnit).rate;
      log(`Fixed pricing: ${rate} per ${unit} (${currency})`);
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

      rate = lookupPrice;
      log(`Lookup pricing for key "${lookupKey}": ${rate} per ${unit} (${currency})`);
      break;
    }
    default: {
      log(`Unsupported pricing strategy: ${videoGenUnit.strategy}`);
      return undefined;
    }
  }

  const quantity = resolveQuantity();
  if (quantity === undefined) return undefined;

  // Keep the original operation order for token pricing so credit rounding is
  // bit-for-bit identical to the previous implementation.
  const costInCurrency = unit === 'millionTokens' ? (rate * quantity) / 1_000_000 : rate * quantity;

  // Convert to USD if needed
  const costInUSD = currency === 'CNY' ? costInCurrency / USD_TO_CNY : costInCurrency;
  const totalCredits = Math.ceil(costInUSD * CREDITS_PER_DOLLAR);

  log(
    `Video cost: ${quantity} x ${rate}/${unit} = ${costInCurrency} ${currency} = $${costInUSD} USD (${totalCredits} credits)`,
  );

  return {
    breakdown: {
      completionTokens,
      lookupKey,
      pricePerMillionTokens: unit === 'millionTokens' ? rate : undefined,
      quantity,
      rate,
      unit,
    },
    totalCost: costInUSD,
    totalCredits,
  };
};
