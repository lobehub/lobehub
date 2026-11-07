import { getCachedTextInputUnitRate } from '@lobechat/utils';
import type { TFunction } from 'i18next';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowDownToDot,
  ArrowUpFromDot,
  AtomIcon,
  AudioLinesIcon,
  CircleFadingArrowUp,
  EyeIcon,
  GlobeIcon,
  ImageIcon,
  PaperclipIcon,
  VideoIcon,
  WrenchIcon,
} from 'lucide-react';
import type {
  FixedPricingUnit,
  ModelPriceCurrency,
  Pricing,
  PricingUnit,
  PricingUnitName,
  TieredPricingUnit,
} from 'model-bank';
import { useCallback, useMemo } from 'react';

import { useBusinessModelPricing } from '@/business/client/hooks/useBusinessModelPricing';
import { useBusinessModelRating } from '@/business/client/hooks/useBusinessModelRating';
import { useEnabledChatModels } from '@/hooks/useEnabledChatModels';
import { useGlobalStore } from '@/store/global';
import type { ModelDetailPanelExpandedKey } from '@/store/global/initialState';
import { systemStatusSelectors } from '@/store/global/selectors';
import type { EnabledProviderWithModels } from '@/types/aiProvider';
import { formatTokenNumber } from '@/utils/format';
import { formatPriceByCurrency, getOriginalUnitRateByName, getUnitRateByName } from '@/utils/index';

import type { PricingMode } from '../types';

export interface FormattedUnitPrice {
  current: string;
  original?: string;
}

interface TextPriceSummary {
  cachedInput: FormattedUnitPrice;
  input: FormattedUnitPrice;
  output: FormattedUnitPrice;
}

const formatPricingRate = (rate: number | undefined, currency?: ModelPriceCurrency) => {
  if (typeof rate !== 'number') return '0';

  return formatPriceByCurrency(rate, currency);
};

const getFormattedUnitPrice = (pricing: Pricing, unitName: PricingUnitName): FormattedUnitPrice => {
  const currency = pricing.currency as ModelPriceCurrency | undefined;
  const currentRate = getUnitRateByName(pricing, unitName);
  const originalRate = getOriginalUnitRateByName(pricing, unitName);

  return {
    current: formatPricingRate(currentRate, currency),
    original:
      typeof originalRate === 'number' ? formatPricingRate(originalRate, currency) : undefined,
  };
};

const DECIMAL_PATTERN = /\d+\.(\d+)/g;

/** The most decimals any number inside the given price texts carries (`0.075` -> 3). */
const getMaxDecimals = (texts: (string | undefined)[]) =>
  texts.reduce(
    (max, text) =>
      [...(text ?? '').matchAll(DECIMAL_PATTERN)].reduce(
        (acc, match) => Math.max(acc, match[1].length),
        max,
      ),
    0,
  );

/** Pad every number in a price text to `digits` decimals (`0.30` -> `0.300`). */
const padDecimals = (text: string, digits: number) =>
  text.replaceAll(DECIMAL_PATTERN, (match, fraction: string) =>
    fraction.length >= digits ? match : match + '0'.repeat(digits - fraction.length),
  );

/**
 * Show prices that are read side by side with the same number of decimals, so `$0.075` and
 * `$0.30` do not sit in one column with their decimal points apart.
 */
const unifyDecimals = (prices: FormattedUnitPrice[]): FormattedUnitPrice[] => {
  const digits = getMaxDecimals(prices.flatMap((price) => [price.current, price.original]));

  return prices.map((price) => ({
    current: padDecimals(price.current, digits),
    original: price.original === undefined ? undefined : padDecimals(price.original, digits),
  }));
};

export const getPrice = (pricing: Pricing): TextPriceSummary => {
  const [cachedInput, input, output] = unifyDecimals([
    getFormattedUnitPrice(pricing, 'textInput_cacheRead'),
    getFormattedUnitPrice(pricing, 'textInput'),
    getFormattedUnitPrice(pricing, 'textOutput'),
  ]);

  return { cachedInput, input, output };
};

type PricingGroup = 'audio' | 'image' | 'text' | 'video';

const UNIT_GROUP_MAP: Record<PricingUnitName, PricingGroup> = {
  audioInput: 'audio',
  audioInput_cacheRead: 'audio',
  audioOutput: 'audio',
  imageGeneration: 'image',
  imageInput: 'image',
  imageInput_cacheRead: 'image',
  imageOutput: 'image',
  textInput: 'text',
  textInput_cacheRead: 'text',
  textInput_cacheWrite: 'text',
  textOutput: 'text',
  videoInput: 'video',
  videoGeneration: 'video',
};

const GROUP_ORDER: PricingGroup[] = ['text', 'image', 'audio', 'video'];

export const UNIT_ICON_MAP: Partial<Record<PricingUnitName, LucideIcon>> = {
  audioInput: ArrowUpFromDot,
  audioInput_cacheRead: CircleFadingArrowUp,
  audioOutput: ArrowDownToDot,
  imageGeneration: ImageIcon,
  imageInput: ArrowUpFromDot,
  imageInput_cacheRead: CircleFadingArrowUp,
  imageOutput: ArrowDownToDot,
  textInput: ArrowUpFromDot,
  textInput_cacheRead: CircleFadingArrowUp,
  textInput_cacheWrite: CircleFadingArrowUp,
  textOutput: ArrowDownToDot,
};

const UNIT_SORT_ORDER: Record<PricingUnitName, number> = {
  textInput: 0,
  textOutput: 1,
  textInput_cacheRead: 2,
  textInput_cacheWrite: 3,
  imageInput: 0,
  imageOutput: 1,
  imageInput_cacheRead: 2,
  imageGeneration: 3,
  audioInput: 0,
  audioOutput: 1,
  audioInput_cacheRead: 2,
  videoInput: 0,
  videoGeneration: 1,
};

/** English fallback for the localized `ModelSwitchPanel.detail.pricing.suffix.*` keys. */
const UNIT_LABEL_MAP: Record<string, string> = {
  image: '/img',
  megapixel: '/MP',
  millionCharacters: '/M chars',
  millionTokens: '/M tokens',
  second: '/s',
};

const formatUnitRate = (unit: PricingUnit, currency?: ModelPriceCurrency): FormattedUnitPrice => {
  const formatRate = (rate: number) => formatPricingRate(rate, currency);
  const formatRange = (low: string, high: string) => `${low} ~ $${high}`;

  if (unit.strategy === 'fixed') {
    const fixedUnit = unit as FixedPricingUnit;
    return {
      current: formatRate(fixedUnit.rate),
      original:
        typeof fixedUnit.originalRate === 'number' && fixedUnit.originalRate > fixedUnit.rate
          ? formatRate(fixedUnit.originalRate)
          : undefined,
    };
  }

  if (unit.strategy === 'tiered') {
    const tiers = (unit as TieredPricingUnit).tiers;
    if (tiers.length === 1) {
      const price = formatRate(tiers[0].rate);
      return {
        current: price,
        original:
          typeof tiers[0].originalRate === 'number' && tiers[0].originalRate > tiers[0].rate
            ? formatRate(tiers[0].originalRate)
            : undefined,
      };
    }
    const low = formatRate(tiers[0].rate);
    const high = formatRate(tiers.at(-1)!.rate);
    const originalLow = tiers[0].originalRate;
    const originalHigh = tiers.at(-1)!.originalRate;
    const original =
      typeof originalLow === 'number' &&
      typeof originalHigh === 'number' &&
      (originalLow > tiers[0].rate || originalHigh > tiers.at(-1)!.rate)
        ? formatRange(formatRate(originalLow), formatRate(originalHigh))
        : undefined;
    return { current: formatRange(low, high), original };
  }

  if (unit.strategy === 'lookup') {
    const entries = Object.entries(unit.lookup.prices);
    if (entries.length === 0) return { current: '--' };

    if (entries.length === 1) {
      const [key, price] = entries[0];
      const originalPrice = unit.lookup.originalPrices?.[key];
      return {
        current: formatRate(price),
        original:
          typeof originalPrice === 'number' && originalPrice > price
            ? formatRate(originalPrice)
            : undefined,
      };
    }
    const sorted = [...entries].sort((a, b) => a[1] - b[1]);
    const [lowKey, lowPrice] = sorted[0];
    const [highKey, highPrice] = sorted.at(-1)!;
    const originalLow = unit.lookup.originalPrices?.[lowKey];
    const originalHigh = unit.lookup.originalPrices?.[highKey];
    const original =
      typeof originalLow === 'number' &&
      typeof originalHigh === 'number' &&
      (originalLow > lowPrice || originalHigh > highPrice)
        ? formatRange(formatRate(originalLow), formatRate(originalHigh))
        : undefined;
    return { current: formatRange(formatRate(lowPrice), formatRate(highPrice)), original };
  }

  return { current: '--' };
};

interface PricingGroupData {
  group: PricingGroup;
  units: PricingUnit[];
}

const groupPricingUnits = (units: PricingUnit[]): PricingGroupData[] => {
  const map = new Map<PricingGroup, PricingUnit[]>();
  for (const unit of units) {
    const group = UNIT_GROUP_MAP[unit.name] || 'text';
    const arr = map.get(group) || [];
    arr.push(unit);
    map.set(group, arr);
  }
  for (const [, arr] of map) {
    arr.sort((a, b) => (UNIT_SORT_ORDER[a.name] ?? 99) - (UNIT_SORT_ORDER[b.name] ?? 99));
  }
  return GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({ group: g, units: map.get(g)! }));
};

interface AbilityItem {
  color: string;
  icon: LucideIcon;
  key: string;
}

const ABILITY_CONFIG: AbilityItem[] = [
  { color: 'success', icon: EyeIcon, key: 'vision' },
  { color: 'success', icon: PaperclipIcon, key: 'files' },
  { color: 'success', icon: ImageIcon, key: 'imageOutput' },
  { color: 'magenta', icon: VideoIcon, key: 'video' },
  { color: 'gold', icon: AudioLinesIcon, key: 'audio' },
  { color: 'info', icon: WrenchIcon, key: 'functionCall' },
  { color: 'purple', icon: AtomIcon, key: 'reasoning' },
  { color: 'cyan', icon: GlobeIcon, key: 'search' },
];

interface UseModelDetailPanelParams {
  enabledList?: EnabledProviderWithModels[];
  modelId?: string;
  pricingMode?: PricingMode;
  provider?: string;
  t: TFunction<'components'>;
}

export const useModelDetailPanel = ({
  enabledList: enabledListProp,
  modelId,
  pricingMode,
  provider,
  t,
}: UseModelDetailPanelParams) => {
  const enabledListFromHook = useEnabledChatModels();
  const enabledList = enabledListProp ?? enabledListFromHook;
  const model = useMemo(() => {
    if (!modelId || !provider) return undefined;
    const providerData = enabledList.find((p) => p.id === provider);
    return providerData?.children.find((m) => m.id === modelId);
  }, [enabledList, modelId, provider]);

  const expandedKeys = useGlobalStore(systemStatusSelectors.modelDetailPanelExpandedKeys);
  const updateExpandedKeys = useGlobalStore((s) => s.updateModelDetailPanelExpandedKeys);
  const applyBusinessModelPricing = useBusinessModelPricing();
  const applyBusinessModelRating = useBusinessModelRating();

  const rating = useMemo(
    () => applyBusinessModelRating({ model: modelId, provider }),
    [applyBusinessModelRating, modelId, provider],
  );

  const pricing = model?.pricing;
  const displayPricing = useMemo(
    () => applyBusinessModelPricing({ model: modelId, pricing, provider }),
    [applyBusinessModelPricing, modelId, pricing, provider],
  );
  const hasPricing = !!displayPricing;
  const formatPrice = displayPricing ? getPrice(displayPricing) : null;
  const hasCachedInputPricing = displayPricing
    ? !!getCachedTextInputUnitRate(displayPricing)
    : false;
  const pricingGroups = useMemo(
    () => (displayPricing ? groupPricingUnits(displayPricing.units) : []),
    [displayPricing],
  );

  const approximatePriceLabel = useMemo(() => {
    if (!displayPricing || !pricingMode) return null;
    const currency = displayPricing.currency as ModelPriceCurrency | undefined;
    if (pricingMode === 'image' && typeof displayPricing.approximatePricePerImage === 'number') {
      const amount = formatPriceByCurrency(displayPricing.approximatePricePerImage, currency);
      return t('ModelSwitchPanel.detail.pricing.perImage', {
        amount,
        defaultValue: '~ ${{amount}} / image',
      });
    }
    if (pricingMode === 'video' && typeof displayPricing.approximatePricePerVideo === 'number') {
      const amount = formatPriceByCurrency(displayPricing.approximatePricePerVideo, currency);
      return t('ModelSwitchPanel.detail.pricing.perVideo', {
        amount,
        defaultValue: '~ ${{amount}} / video',
      });
    }
    return null;
  }, [displayPricing, pricingMode, t]);

  const getPricingTooltip = useCallback(
    (key: 'cachedInput' | 'input' | 'output', amount: string): string => {
      const fallbackKey =
        key === 'cachedInput'
          ? 'ModelSwitchPanel.detail.pricing.cachedInput'
          : `ModelSwitchPanel.detail.pricing.${key}`;

      return t(fallbackKey as any, { amount });
    },
    [t],
  );

  // Rows priced in the same unit (`/M tokens`) are compared by eye, so they share decimals
  const decimalsByUnit = useMemo(() => {
    const currency = displayPricing?.currency as ModelPriceCurrency | undefined;
    const texts = new Map<string, (string | undefined)[]>();
    for (const unit of displayPricing?.units ?? []) {
      const price = formatUnitRate(unit, currency);
      texts.set(unit.unit, [...(texts.get(unit.unit) ?? []), price.current, price.original]);
    }

    return new Map<string, number>(
      [...texts].map(([unit, values]) => [unit, getMaxDecimals(values)] as [string, number]),
    );
  }, [displayPricing?.currency, displayPricing?.units]);

  const formatUnitPrice = useCallback(
    (unit: PricingUnit): FormattedUnitPrice => {
      const price = formatUnitRate(unit, displayPricing?.currency as ModelPriceCurrency);
      const digits = decimalsByUnit.get(unit.unit) ?? 0;

      return {
        current: padDecimals(price.current, digits),
        original: price.original === undefined ? undefined : padDecimals(price.original, digits),
      };
    },
    [decimalsByUnit, displayPricing?.currency],
  );

  const getUnitPriceSuffix = useCallback(
    (unit: PricingUnit['unit']) =>
      UNIT_LABEL_MAP[unit]
        ? String(
            t(`ModelSwitchPanel.detail.pricing.suffix.${unit}` as any, {
              defaultValue: UNIT_LABEL_MAP[unit],
            }),
          )
        : '',
    [t],
  );

  const handleExpandedChange = useCallback(
    (keys: unknown[]) => updateExpandedKeys(keys as ModelDetailPanelExpandedKey[]),
    [updateExpandedKeys],
  );

  const contextWindowLabel = useMemo(() => {
    if (typeof model?.contextWindowTokens !== 'number') return null;

    return model.contextWindowTokens === 0
      ? '∞'
      : `${formatTokenNumber(model.contextWindowTokens)} tokens`;
  }, [model?.contextWindowTokens]);

  const enabledAbilities = useMemo(
    () =>
      model
        ? ABILITY_CONFIG.filter((a) => model.abilities[a.key as keyof typeof model.abilities])
        : [],
    [model],
  );

  return {
    approximatePriceLabel,
    contextWindowLabel,
    enabledAbilities,
    expandedKeys,
    formatPrice,
    formatUnitPrice,
    getPricingTooltip,
    getUnitPriceSuffix,
    handleExpandedChange,
    hasAbilities: enabledAbilities.length > 0,
    hasCachedInputPricing,
    hasPricing,
    isAbilitiesExpanded: expandedKeys.includes('abilities'),
    isPricingExpanded: expandedKeys.includes('pricing'),
    model,
    pricingGroups,
    rating,
  };
};
