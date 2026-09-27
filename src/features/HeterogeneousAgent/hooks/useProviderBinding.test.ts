import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiInfraStore } from '@/store/aiInfra/store';

import { useProviderBindingCompatibleProviders } from './useProviderBinding';

type ProviderState = Pick<
  AiInfraStore,
  'enabledAiModels' | 'enabledAiProviders' | 'providerBindingAgentTypes'
>;

const { state } = vi.hoisted(() => ({
  state: {
    enabledAiModels: [],
    enabledAiProviders: [],
    providerBindingAgentTypes: {},
  } as ProviderState,
}));

vi.mock('@/store/aiInfra', () => ({
  useAiInfraStore: (selector: (value: ProviderState) => unknown) => selector(state),
}));

describe('useProviderBindingCompatibleProviders', () => {
  beforeEach(() => {
    state.enabledAiProviders = [
      { id: 'bound', name: 'Bound provider', source: 'custom' },
      { id: 'other', source: 'custom' },
    ];
    state.providerBindingAgentTypes = { bound: ['kimi-code'], other: ['kimi-code'] };
    state.enabledAiModels = [
      {
        abilities: { functionCall: false },
        id: 'no-tools',
        providerId: 'bound',
        type: 'chat',
      },
    ];
  });

  it('keeps the bound provider visible when no compatible models remain', () => {
    const { result } = renderHook(() =>
      useProviderBindingCompatibleProviders('kimi-code', 'bound'),
    );

    expect(result.current.providers).toEqual([
      { id: 'bound', name: 'Bound provider', source: 'custom' },
    ]);
    expect(result.current.modelsByProvider).toEqual({});
  });

  it('retains the stale binding alongside another provider with selectable models', () => {
    state.enabledAiModels!.push({
      abilities: { functionCall: true },
      id: 'with-tools',
      providerId: 'other',
      type: 'chat',
    });
    const { result } = renderHook(() =>
      useProviderBindingCompatibleProviders('kimi-code', 'bound'),
    );

    expect(result.current.providers.map(({ id }) => id)).toEqual(['bound', 'other']);
    expect(result.current.modelsByProvider).toEqual({
      other: [{ id: 'with-tools', providerId: 'other' }],
    });
  });

  it('follows changes to the effective binding without retaining unrelated empty providers', () => {
    const { result, rerender } = renderHook(
      ({ providerId }) => useProviderBindingCompatibleProviders('kimi-code', providerId),
      { initialProps: { providerId: 'bound' } },
    );

    rerender({ providerId: 'other' });
    expect(result.current.providers.map(({ id }) => id)).toEqual(['other']);
    expect(result.current.modelsByProvider).toEqual({});
  });

  it('does not restore a disabled or protocol-incompatible bound provider', () => {
    state.providerBindingAgentTypes.bound = ['codex'];
    state.providerBindingAgentTypes.disabled = ['kimi-code'];
    const { result, rerender } = renderHook(
      ({ providerId }) => useProviderBindingCompatibleProviders('kimi-code', providerId),
      { initialProps: { providerId: 'bound' } },
    );

    expect(result.current.providers).toEqual([]);
    rerender({ providerId: 'disabled' });
    expect(result.current.providers).toEqual([]);
  });
});
