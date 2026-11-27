import { USD_TO_CNY } from '@lobechat/const/currency';
import { getTextInputUnitRate } from '@lobechat/utils';
import { type Pricing } from 'model-bank';

import { type ListItem } from './types';

export const menuKey = (provider: string, model: string) => `${provider}-${model}`;

type ModelPredicate = (modelId: string, providerId: string) => boolean;

/**
 * Why a listed model cannot be picked from a provider, or `undefined` when it can. A
 * restricted model keeps its upsell, so only an otherwise unrestricted one is disabled.
 */
export const resolveModelDisabledReason = (
  {
    getDisabledReason,
    isModelRestricted,
  }: {
    getDisabledReason?: (modelId: string, providerId: string) => string | undefined;
    isModelRestricted?: ModelPredicate;
  },
  modelId: string,
  providerId: string,
): string | undefined =>
  isModelRestricted?.(modelId, providerId) ? undefined : getDisabledReason?.(modelId, providerId);

/**
 * The switch panel's hide predicate: the business guard's `isModelHidden`, except that a
 * model with a disabled reason stays listed (dimmed) so the viewer learns why it is out of
 * reach. Other pickers keep hiding it.
 */
export const resolvePanelHiddenPredicate = (
  isModelHidden?: ModelPredicate,
  getModelDisabledReason?: (modelId: string, providerId: string) => string | undefined,
): ModelPredicate | undefined =>
  isModelHidden && getModelDisabledReason
    ? (modelId, providerId) =>
        isModelHidden(modelId, providerId) && !getModelDisabledReason(modelId, providerId)
    : isModelHidden;

export const getListItemKey = (item: ListItem): string => {
  switch (item.type) {
    case 'model-item-single':
    case 'model-item-multiple': {
      return item.data.displayName;
    }
    case 'featured-model-item':
    case 'provider-model-item': {
      return menuKey(item.provider.id, item.model.id);
    }
    case 'group-header': {
      return `header-${item.provider.id}`;
    }
    case 'empty-model': {
      return `empty-${item.provider.id}`;
    }
    case 'no-provider': {
      return 'no-provider';
    }
  }
};

/**
 * Input price relative to the $1 / 1M input tokens baseline, so the model list
 * can compare cost at a glance. Tiered pricing uses its first (cheapest) tier.
 * Returns `undefined` when the model has no text input price.
 */
export const getInputPriceMultiplier = (pricing?: Pricing): number | undefined => {
  const rate = getTextInputUnitRate(pricing);
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0) return undefined;

  return pricing?.currency === 'CNY' ? rate / USD_TO_CNY : rate;
};

/** 0.0125 → "0.013", 0.3 → "0.3", 1.25 → "1.25", 15 → "15" */
export const formatPriceMultiplier = (multiplier: number): string => {
  if (multiplier >= 10) return String(Math.round(multiplier));
  if (multiplier >= 0.1) return String(Number(multiplier.toFixed(2)));

  return String(Number(multiplier.toPrecision(2)));
};
