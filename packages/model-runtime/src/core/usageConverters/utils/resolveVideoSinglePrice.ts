import type { Pricing } from 'model-bank';

export interface VideoSinglePriceResult {
  approximatePrice?: number;
}

export const resolveVideoSinglePrice = (pricing?: Pricing): VideoSinglePriceResult => {
  if (!pricing) return {};

  if (typeof pricing.approximatePricePerVideo === 'number') {
    return { approximatePrice: pricing.approximatePricePerVideo };
  }

  return {};
};
