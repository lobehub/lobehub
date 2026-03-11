import type { Pricing, PricingUnit, PricingUnitName } from 'model-bank';

/**
 * Internal helper to extract the displayed unit rate from a pricing unit by strategy
 * - fixed: rate
 * - tiered: tiers[0].rate
 * - lookup: first price value
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
      const prices = Object.values(unit.lookup?.prices || {});
      return prices[0];
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
