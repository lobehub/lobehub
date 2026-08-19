import type { Pricing } from 'model-bank';

export interface VideoSinglePriceResult {
  approximatePrice?: number;
}

/** Matches Create Video's default clip length when approximatePricePerVideo is absent. */
const DEFAULT_CLIP_SECONDS = 5;

const lowestLookupPrice = (prices: Record<string, number> | undefined) => {
  const values = Object.values(prices ?? {});
  if (values.length === 0) return undefined;
  return Math.min(...values);
};

export const resolveVideoSinglePrice = (pricing?: Pricing): VideoSinglePriceResult => {
  if (!pricing) return {};

  if (typeof pricing.approximatePricePerVideo === 'number') {
    return { approximatePrice: pricing.approximatePricePerVideo };
  }

  const videoUnit = pricing.units.find((unit) => unit.name === 'videoGeneration');
  if (!videoUnit) return {};

  if (videoUnit.strategy === 'fixed') {
    if (videoUnit.unit === 'video') return { approximatePrice: videoUnit.rate };
    if (videoUnit.unit === 'second') {
      return { approximatePrice: videoUnit.rate * DEFAULT_CLIP_SECONDS };
    }
    return {};
  }

  if (videoUnit.strategy === 'lookup') {
    const lowest = lowestLookupPrice(videoUnit.lookup.prices);
    if (typeof lowest !== 'number') return {};
    if (videoUnit.unit === 'second') return { approximatePrice: lowest * DEFAULT_CLIP_SECONDS };
    if (videoUnit.unit === 'video') return { approximatePrice: lowest };
    return {};
  }

  return {};
};
