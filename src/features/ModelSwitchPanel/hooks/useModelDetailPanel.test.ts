/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import type { TFunction } from 'i18next';
import type { Pricing } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EnabledProviderWithModels } from '@/types/aiProvider';

import { useModelDetailPanel } from './useModelDetailPanel';

const {
  globalState,
  updateExpandedKeysMock,
  useBusinessModelPricingMock,
  useEnabledChatModelsMock,
} = vi.hoisted(() => ({
  globalState: {
    status: {
      modelDetailPanelExpandedKeys: ['pricing'],
    },
    updateModelDetailPanelExpandedKeys: vi.fn(),
  },
  updateExpandedKeysMock: vi.fn(),
  useBusinessModelPricingMock: vi.fn(),
  useEnabledChatModelsMock: vi.fn(),
}));

vi.mock('@/hooks/useEnabledChatModels', () => ({
  useEnabledChatModels: useEnabledChatModelsMock,
}));

vi.mock('@/business/client/hooks/useBusinessModelPricing', () => ({
  useBusinessModelPricing: useBusinessModelPricingMock,
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: typeof globalState) => unknown) => selector(globalState),
}));

vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: {
    modelDetailPanelExpandedKeys: (state: typeof globalState) =>
      state.status.modelDetailPanelExpandedKeys,
  },
}));

const translations: Record<string, string> = {};

const t = ((key: string, options?: Record<string, string>) => {
  const template = translations[key] ?? options?.defaultValue ?? key;

  return template.replaceAll(/\{\{(\w+)\}\}/g, (_, name) => options?.[name] ?? '');
}) as TFunction<'components'>;

const basePricing = {
  currency: 'USD',
  units: [
    { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
    { name: 'textOutput', rate: 25, strategy: 'fixed', unit: 'millionTokens' },
  ],
} as Pricing;

const discountedPricing = {
  currency: 'USD',
  units: [
    { name: 'textInput', originalRate: 5, rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
    { name: 'textOutput', originalRate: 25, rate: 12.5, strategy: 'fixed', unit: 'millionTokens' },
    {
      name: 'textInput_cacheRead',
      originalRate: 1,
      rate: 0.3,
      strategy: 'fixed',
      unit: 'millionTokens',
    },
  ],
} as Pricing;

const unitPricing = {
  currency: 'USD',
  units: [
    {
      name: 'imageGeneration',
      strategy: 'tiered',
      tiers: [{ originalRate: 0.05, rate: 0.02, upTo: 'infinity' }],
      unit: 'image',
    },
    {
      lookup: { originalPrices: { standard: 0.5 }, prices: { standard: 0.3 } },
      name: 'videoGeneration',
      strategy: 'lookup',
      unit: 'video',
    },
  ],
} as Pricing;

const subCentPricing = {
  currency: 'USD',
  units: [
    { name: 'textInput', rate: 0.075, strategy: 'fixed', unit: 'millionTokens' },
    { name: 'textOutput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
    { name: 'imageGeneration', rate: 0.04, strategy: 'fixed', unit: 'image' },
  ],
} as Pricing;

const emptyLookupPricing = {
  currency: 'USD',
  units: [{ lookup: { prices: {} }, name: 'imageGeneration', strategy: 'lookup', unit: 'image' }],
} as Pricing;

const createEnabledList = (
  provider: string,
  pricing: Pricing,
  overrides: Record<string, unknown> = {},
): EnabledProviderWithModels[] => [
  {
    children: [
      {
        abilities: {},
        contextWindowTokens: 1_000_000,
        displayName: 'Test Model',
        id: 'test-model',
        pricing,
        type: 'chat',
        ...overrides,
      } as any,
    ],
    id: provider,
    name: provider,
    source: 'builtin',
  },
];

const renderModelDetailPanelHook = (
  params: Partial<Parameters<typeof useModelDetailPanel>[0]> = {},
) =>
  renderHook(() =>
    useModelDetailPanel({
      enabledList: createEnabledList('lobehub', basePricing),
      modelId: 'test-model',
      provider: 'lobehub',
      t,
      ...params,
    }),
  );

describe('useModelDetailPanel', () => {
  beforeEach(() => {
    globalState.status.modelDetailPanelExpandedKeys = ['pricing'];
    globalState.updateModelDetailPanelExpandedKeys = updateExpandedKeysMock;
    updateExpandedKeysMock.mockReset();
    useEnabledChatModelsMock.mockReturnValue([]);
    useBusinessModelPricingMock.mockReturnValue(({ pricing }: { pricing?: Pricing }) => pricing);
  });

  it('applies business pricing before formatting LobeHub USD prices', () => {
    useBusinessModelPricingMock.mockReturnValue(
      ({ pricing, model, provider }: { model?: string; pricing?: Pricing; provider?: string }) =>
        provider === 'lobehub' && model === 'test-model' ? discountedPricing : pricing,
    );

    const { result } = renderModelDetailPanelHook();

    expect(result.current.formatPrice?.input).toEqual({ current: '2.50', original: '5.00' });
    expect(result.current.formatPrice?.output).toEqual({ current: '12.50', original: '25.00' });
    expect(result.current.formatPrice?.cachedInput).toEqual({
      current: '0.30',
      original: '1.00',
    });
    expect(result.current.hasCachedInputPricing).toBe(true);
    expect(result.current.getUnitPriceSuffix('millionTokens')).toBe('/M tokens');
  });

  it('formats original unit prices for tiered and lookup units', () => {
    const { result } = renderModelDetailPanelHook({
      enabledList: createEnabledList('lobehub', unitPricing),
    });

    expect(result.current.formatUnitPrice(unitPricing.units[0])).toEqual({
      current: '0.02',
      original: '0.05',
    });
    expect(result.current.formatUnitPrice(unitPricing.units[1])).toEqual({
      current: '0.30',
      original: '0.50',
    });
  });

  it('shows the prices read side by side with the same decimals', () => {
    const { result } = renderModelDetailPanelHook({
      enabledList: createEnabledList('lobehub', subCentPricing),
    });

    // `$0.075` and `$0.30` would put their decimal points apart in one column
    expect(result.current.formatPrice?.input.current).toBe('0.075');
    expect(result.current.formatPrice?.output.current).toBe('0.300');
  });

  it('pads unit rows only against rows priced in the same unit', () => {
    const { result } = renderModelDetailPanelHook({
      enabledList: createEnabledList('lobehub', subCentPricing),
    });
    const [input, output, image] = subCentPricing.units;

    expect(result.current.formatUnitPrice(input).current).toBe('0.075');
    expect(result.current.formatUnitPrice(output).current).toBe('0.300');
    // A per-image rate is a different unit: it keeps its own two decimals
    expect(result.current.formatUnitPrice(image).current).toBe('0.04');
  });

  it('reads an empty price table as -- rather than a lone dash', () => {
    const { result } = renderModelDetailPanelHook({
      enabledList: createEnabledList('lobehub', emptyLookupPricing),
    });

    expect(result.current.formatUnitPrice(emptyLookupPricing.units[0]).current).toBe('--');
  });

  it('localizes the unit suffix and falls back to English when a locale lacks it', () => {
    const { result } = renderModelDetailPanelHook();

    expect(result.current.getUnitPriceSuffix('millionTokens')).toBe('/M tokens');

    translations['ModelSwitchPanel.detail.pricing.suffix.millionTokens'] = '/百万 token';
    try {
      const localized = renderModelDetailPanelHook();

      expect(localized.result.current.getUnitPriceSuffix('millionTokens')).toBe('/百万 token');
    } finally {
      delete translations['ModelSwitchPanel.detail.pricing.suffix.millionTokens'];
    }
  });

  it('uses the enabled model list hook when no list is provided', () => {
    useEnabledChatModelsMock.mockReturnValue(
      createEnabledList('lobehub', basePricing, {
        abilities: { reasoning: true },
      }),
    );

    const { result } = renderModelDetailPanelHook({ enabledList: undefined });

    expect(result.current.model?.id).toBe('test-model');
    expect(result.current.contextWindowLabel).toBe('1M tokens');
    expect(result.current.hasAbilities).toBe(true);
  });

  it('updates expanded detail sections', () => {
    const { result } = renderModelDetailPanelHook();

    act(() => {
      result.current.handleExpandedChange(['abilities']);
    });

    expect(updateExpandedKeysMock).toHaveBeenCalledWith(['abilities']);
  });
});
