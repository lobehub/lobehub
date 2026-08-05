import type { ModelRating } from 'model-bank';

export interface BusinessModelRatingParams {
  model?: string;
  provider?: string;
}

export const applyBusinessModelRating = (
  _params: BusinessModelRatingParams,
): ModelRating | undefined => undefined;

export const useBusinessModelRating = () => applyBusinessModelRating;
