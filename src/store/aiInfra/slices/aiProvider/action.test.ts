import { act, renderHook } from '@testing-library/react';
import type { AiProviderModelListItem } from 'model-bank';
import type { PropsWithChildren } from 'react';
import { createElement } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { aiProviderService } from '@/services/aiProvider';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(SWRConfig, { value: { dedupingInterval: 0, provider: () => new Map() } }, children);

const model = (id: string) =>
  ({
    abilities: {},
    enabled: true,
    id,
    source: 'builtin',
    type: 'chat',
  }) as AiProviderModelListItem;

describe('AiProviderAction', () => {
  describe('ensureAiProviderRuntimeStateReady', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
      useAiInfraStore.setState({ isInitAiProviderRuntimeState: false });
    });

    it('resolves immediately without refreshing when the runtime-state is already loaded', async () => {
      const refresh = vi.fn(async () => {});
      useAiInfraStore.setState({
        isInitAiProviderRuntimeState: true,
        refreshAiProviderRuntimeState: refresh,
      });

      await useAiInfraStore.getState().ensureAiProviderRuntimeStateReady();

      expect(refresh).not.toHaveBeenCalled();
    });

    it('triggers a refresh and awaits it when the runtime-state is not loaded', async () => {
      const refresh = vi.fn(async () => {});
      useAiInfraStore.setState({
        isInitAiProviderRuntimeState: false,
        refreshAiProviderRuntimeState: refresh,
      });

      await useAiInfraStore.getState().ensureAiProviderRuntimeStateReady();

      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('falls back after the timeout when the refresh never settles', async () => {
      vi.useFakeTimers();
      // A refresh that never resolves — e.g. still gated behind an unresolved
      // auth session. The caller must not be blocked forever.
      const refresh = vi.fn(() => new Promise<void>(() => {}));
      useAiInfraStore.setState({
        isInitAiProviderRuntimeState: false,
        refreshAiProviderRuntimeState: refresh,
      });

      const pending = useAiInfraStore.getState().ensureAiProviderRuntimeStateReady(1000);
      await vi.advanceTimersByTimeAsync(1000);

      await expect(pending).resolves.toBeUndefined();
    });

    it('does not reject when the refresh throws', async () => {
      const refresh = vi.fn(async () => {
        throw new Error('network down');
      });
      useAiInfraStore.setState({
        isInitAiProviderRuntimeState: false,
        refreshAiProviderRuntimeState: refresh,
      });

      await expect(
        useAiInfraStore.getState().ensureAiProviderRuntimeStateReady(),
      ).resolves.toBeUndefined();
    });
  });

  describe('useFetchAiProviderItem', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      act(() => {
        useAiInfraStore.setState({ activeAiProvider: undefined, aiModelListMap: {} });
      });
    });

    const navigateFromAToB = () => {
      act(() => {
        useAiInfraStore.setState({
          activeAiProvider: 'provider-a',
          aiModelListMap: { 'provider-a': [model('a-model')], 'provider-b': [model('b-model')] },
        });
      });

      return renderHook(() => useAiInfraStore.getState().useFetchAiProviderItem('provider-b'), {
        wrapper,
      });
    };

    it('activates the routed provider while its detail request is still in flight', () => {
      vi.spyOn(aiProviderService, 'getAiProviderById').mockImplementation(
        () => new Promise(() => {}),
      );

      navigateFromAToB();

      const state = useAiInfraStore.getState();
      expect(state.activeAiProvider).toBe('provider-b');
      expect(aiModelSelectors.filteredAiProviderModelList(state).map((m) => m.id)).toEqual([
        'b-model',
      ]);
    });

    it('activates the routed provider even when its detail request fails', async () => {
      vi.spyOn(aiProviderService, 'getAiProviderById').mockRejectedValue(new Error('boom'));

      navigateFromAToB();
      await act(async () => {});

      expect(useAiInfraStore.getState().activeAiProvider).toBe('provider-b');
    });
  });
});
