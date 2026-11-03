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
