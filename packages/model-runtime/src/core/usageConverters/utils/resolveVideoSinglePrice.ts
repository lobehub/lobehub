import type { Pricing } from 'model-bank';

import type { VideoGenerationParams, VideoRequestPricingInputs } from './computeVideoCost';
import { computeVideoRequestCost } from './computeVideoCost';

export interface VideoSinglePriceResult {
  /** Configured `approximatePricePerVideo`, used to hold models priced by reported usage */
  approximatePrice?: number;
  /**
   * Exact price of the request, set only when every pricing unit is known before generation
   * (see `computeVideoRequestCost`); such a request is charged this amount without adjustment.
   */
  price?: number;
}

/**
 * Resolve the per-request video price used for budget holds and price display.
 */
export const resolveVideoSinglePrice = (
  pricing?: Pricing,
  params?: VideoGenerationParams,
  inputs?: VideoRequestPricingInputs,
): VideoSinglePriceResult => {
  if (!pricing) return {};

  const result: VideoSinglePriceResult = {};
  if (typeof pricing.approximatePricePerVideo === 'number') {
    result.approximatePrice = pricing.approximatePricePerVideo;
  }

  if (params) {
    const requestCost = computeVideoRequestCost(pricing, params, inputs);
    if (requestCost) result.price = requestCost.totalCost;
  }

  return result;
};
