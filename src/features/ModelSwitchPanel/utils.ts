import { USD_TO_CNY } from '@lobechat/const/currency';
import { getTextInputUnitRate } from '@lobechat/utils';
import { type Pricing } from 'model-bank';

import type { EnabledProviderWithModels } from '@/types/aiProvider';

import { type ListItem } from './types';

/**
 * Drop the models `isHidden` leaves out, and any provider left without a model.
 * Returns the list unchanged (same reference) when nothing is hidden.
 */
export const filterHiddenModels = (
  enabledList: EnabledProviderWithModels[],
  isHidden?: (modelId: string, providerId: string) => boolean,
): EnabledProviderWithModels[] => {
  if (!isHidden) return enabledList;

  let changed = false;
  const filtered = enabledList.flatMap((provider) => {
    const children = provider.children.filter((model) => !isHidden(model.id, provider.id));
    if (children.length === provider.children.length) return [provider];

    changed = true;
    return children.length > 0 ? [{ ...provider, children }] : [];
  });

  return changed ? filtered : enabledList;
};

export const menuKey = (provider: string, model: string) => `${provider}-${model}`;

export const getListItemKey = (item: ListItem): string => {
  switch (item.type) {
    case 'model-item-single':
    case 'model-item-multiple': {
      return item.data.displayName;
    }
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
