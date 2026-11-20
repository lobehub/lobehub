import type { LookupPricingUnit, Pricing, PricingUnit, PricingUnitName } from 'model-bank';

/**
 * Cache TTL a request uses unless it asks for a longer one; Anthropic's prompt caching
 * defaults to 5 minutes, and cache-write lookups key their prices by `ttl`.
 */
const DEFAULT_CACHE_TTL_KEY = '5m';

/**
 * Lookup key whose price represents the unit in a single-price display.
 * Keys are sorted alphabetically in model-bank, so the first key of a TTL lookup is `1h`;
 * showing it would quote the 1-hour cache write as the model's cache-write price.
 */
const getDisplayLookupKey = (unit: LookupPricingUnit): string | undefined => {
  const prices = unit.lookup?.prices || {};
  if (unit.lookup?.pricingParams?.includes('ttl') && DEFAULT_CACHE_TTL_KEY in prices) {
    return DEFAULT_CACHE_TTL_KEY;
  }
  return Object.keys(prices)[0];
};

/**
 * Internal helper to extract the displayed unit rate from a pricing unit by strategy
 * - fixed: rate
 * - tiered: tiers[0].rate
 * - lookup: the default-TTL (`5m`) price for TTL lookups, otherwise the first price value
 */
const getRateFromUnit = (unit: PricingUnit): number | undefined => {
  switch (unit.strategy) {
    case 'fixed': {
      return unit.rate;
    }
    case 'tiered': {
      return unit.tiers?.[0]?.rate;
    }
    case 'lookup': {
      const key = getDisplayLookupKey(unit);
      return key ? unit.lookup.prices[key] : undefined;
    }
    default: {
      return undefined;
    }
  }
};

const getOriginalRateFromUnit = (unit: PricingUnit): number | undefined => {
  switch (unit.strategy) {
    case 'fixed': {
      return unit.originalRate;
    }
    case 'tiered': {
      return unit.tiers?.[0]?.originalRate;
    }
    case 'lookup': {
      const key = getDisplayLookupKey(unit);
      return key ? unit.lookup.originalPrices?.[key] : undefined;
    }
    default: {
      return undefined;
    }
  }
};

/**
 * Get unit rate by unit name, used to deduplicate logic across helpers
 */
export const getUnitRateByName = (
  pricing?: Pricing,
  unitName?: PricingUnitName,
): number | undefined => {
  if (!pricing?.units || !unitName) return undefined;
  const unit = pricing.units.find((u) => u.name === unitName);
  if (!unit) return undefined;
  return getRateFromUnit(unit);
};

/**
 * Get unit original rate by unit name when it is higher than the current rate.
 */
export const getOriginalUnitRateByName = (
  pricing?: Pricing,
  unitName?: PricingUnitName,
): number | undefined => {
  if (!pricing?.units || !unitName) return undefined;
  const unit = pricing.units.find((u) => u.name === unitName);
  if (!unit) return undefined;

  const originalRate = getOriginalRateFromUnit(unit);
  const currentRate = getRateFromUnit(unit);
  if (typeof originalRate !== 'number' || typeof currentRate !== 'number') return undefined;

  return originalRate > currentRate ? originalRate : undefined;
};

/**
 * Get text input unit rate from pricing
 * - fixed: rate
 * - tiered: tiers[0].rate
 * - lookup: Object.values(lookup.prices)[0]
 */
export function getTextInputUnitRate(pricing?: Pricing): number | undefined {
  return getUnitRateByName(pricing, 'textInput');
}

/**
 * Get text output unit rate from pricing
 */
export function getTextOutputUnitRate(pricing?: Pricing): number | undefined {
  return getUnitRateByName(pricing, 'textOutput');
}

/**
 * Get audio input unit rate from pricing
 */
export function getAudioInputUnitRate(pricing?: Pricing): number | undefined {
  return getUnitRateByName(pricing, 'audioInput');
}

/**
 * Get audio output unit rate from pricing
 */
export function getAudioOutputUnitRate(pricing?: Pricing): number | undefined {
  return getUnitRateByName(pricing, 'audioOutput');
}

/**
 * Get cached text input unit rate from pricing
 */
export function getCachedTextInputUnitRate(pricing?: Pricing): number | undefined {
  return getUnitRateByName(pricing, 'textInput_cacheRead');
}

/**
 * Get write cache input unit rate from pricing (TextInputCacheWrite)
 */
export function getWriteCacheInputUnitRate(pricing?: Pricing): number | undefined {
  return getUnitRateByName(pricing, 'textInput_cacheWrite');
}

/**
 * Get cached audio input unit rate from pricing
 */
export function getCachedAudioInputUnitRate(pricing?: Pricing): number | undefined {
  return getUnitRateByName(pricing, 'audioInput_cacheRead');
}
