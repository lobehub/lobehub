import type { Pricing } from 'model-bank';

export interface BusinessModelPricingParams {
  model?: string;
  pricing?: Pricing;
  provider?: string;
}

export const applyBusinessModelPricing = ({ pricing }: BusinessModelPricingParams) => pricing;

export const useBusinessModelPricing = () => applyBusinessModelPricing;

export const useBusinessModelPricingPrefetch = () => {};
