import { cssVar } from 'antd-style';
import { type AiModelForSelect, type ModelRating, type Pricing } from 'model-bank';
import { createContext, useContext } from 'react';

import { type BusinessModelPricingParams } from '@/business/client/hooks/useBusinessModelPricing';
import { type BusinessModelRatingParams } from '@/business/client/hooks/useBusinessModelRating';

import { type ListItem } from '../../types';
import { getInputPriceMultiplier } from '../../utils';

export const RATING_KEYS = ['intelligence', 'speed'] as const;
export type RatingKey = (typeof RATING_KEYS)[number];

export const RATING_COLORS: Record<RatingKey, string> = {
  intelligence: cssVar.colorInfo,
  speed: cssVar.colorSuccess,
};

/** Fixed column widths keep bars and multipliers aligned from row to row. */
export const META_COLUMN_GAP = 8;
export const RATING_COLUMN_WIDTH = 24;
export const PRICE_COLUMN_WIDTH = 36;

export interface MetaColumns {
  price: boolean;
  rating: boolean;
}

/**
 * Which comparison columns the current list shows. Rows reserve a column's width
 * even when their own value is missing, so the other columns stay aligned.
 */
export const MetaColumnsContext = createContext<MetaColumns>({ price: true, rating: true });

export const useMetaColumns = () => useContext(MetaColumnsContext);

const listItemModels = (item: ListItem): { model: AiModelForSelect; provider: string }[] => {
  switch (item.type) {
    case 'provider-model-item': {
      return [{ model: item.model, provider: item.provider.id }];
    }
    case 'model-item-single':
    case 'model-item-multiple': {
      return item.data.providers.map((p) => ({ model: item.data.model, provider: p.id }));
    }
    default: {
      return [];
    }
  }
};

export const resolveMetaColumns = (
  items: ListItem[],
  resolvePricing: (params: BusinessModelPricingParams) => Pricing | undefined,
  resolveRating: (params: BusinessModelRatingParams) => ModelRating | undefined,
): MetaColumns => {
  const columns: MetaColumns = { price: false, rating: false };
  for (const { model, provider } of items.flatMap(listItemModels)) {
    if (!columns.price) {
      const pricing = resolvePricing({ model: model.id, pricing: model.pricing, provider });
      columns.price = getInputPriceMultiplier(pricing) !== undefined;
    }
    if (!columns.rating) {
      const rating = resolveRating({ model: model.id, provider });
      columns.rating = RATING_KEYS.some((key) => typeof rating?.[key]?.score === 'number');
    }
    if (columns.price && columns.rating) break;
  }
  return columns;
};
