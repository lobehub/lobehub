import type { Pricing } from 'model-bank';

import type { VideoGenerationParams } from './computeVideoCost';
import { computeVideoDurationCost } from './computeVideoCost';

export interface VideoSinglePriceResult {
  approximatePrice?: number;
}

/**
 * Resolve the per-request video price used for budget holds and price display.
 *
 * Per-second priced models (e.g. fal H3 Max) are exact once the request params are known, so a
 * 15s 1080p request is not held at the price of a default clip; other models fall back to the
 * configured `approximatePricePerVideo`.
 */
export const resolveVideoSinglePrice = (
  pricing?: Pricing,
  params?: VideoGenerationParams,
): VideoSinglePriceResult => {
  if (!pricing) return {};

  if (params) {
    const durationCost = computeVideoDurationCost(pricing, params);
    if (durationCost) return { approximatePrice: durationCost.totalCost };
  }

  if (typeof pricing.approximatePricePerVideo === 'number') {
    return { approximatePrice: pricing.approximatePricePerVideo };
  }

  return {};
};
