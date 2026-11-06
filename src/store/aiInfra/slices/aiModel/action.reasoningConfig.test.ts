import { randomUUID } from 'node:crypto';

import { toast } from '@lobehub/ui';
import { act, renderHook, waitFor } from '@testing-library/react';
import type * as I18nextModule from 'i18next';
import { t } from 'i18next';
import type { PropsWithChildren } from 'react';
import { createElement } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope, identityScopeOf } from '@/libs/replica';
import type * as SwrModule from '@/libs/swr';
import { aiModelService } from '@/services/aiModel';
import { withSWR } from '~test-utils';

import { useAiInfraStore as useStore } from '../../store';
import { initialAIModelState } from './initialState';
import { aiModelReasoningConfigResource } from './projection';
import { aiModelSelectors } from './selectors';

vi.mock('i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof I18nextModule>();
  return {
    ...actual,
    t: vi.fn((key: string) => key),
  };
});

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import('~base-ui-stubs')).baseUiStubs,
}));

vi.mock('@/libs/swr', async (importOriginal) => {
  const actual = await importOriginal<typeof SwrModule>();
  return {
    ...actual,
    mutate: vi.fn(),
  };
});

/**
 * The per-model-instance reasoning config is a replica
 * (`modelReasoningConfigMap[provider/model]`): it paints from the persisted
 * copy on the first frame, the network only confirms, and a save persists the
 * confirmed value. Read it through the selectors.
 */
const wrapper = ({ children }: PropsWithChildren) =>
  createElement(SWRConfig, { value: { dedupingInterval: 0, provider: () => new Map() } }, children);

/** Never-resolving fetch: the first frame can only come from storage. */
const pending = () => new Promise<never>(() => {});

const REASONING_PARAMS = { model: 'gpt-5.2', provider: 'openai' };
const REASONING_STORAGE_KEY = aiModelReasoningConfigResource.storageKey(REASONING_PARAMS);

describe('AiModelAction reasoning config', () => {
  const scopes = new Set<string>();
  let scope = '';
  const useScope = (next: string) => {
    scope = next;
    scopes.add(next);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  };

  /** Reasoning configs are personal, so their rows land in the identity partition. */
  const rowScope = (value = scope) => identityScopeOf(value);

  beforeEach(() => {
    vi.clearAllMocks();
    useScope(`ai-model-user-${randomUUID()}:personal`);

    // Reset store to initial state
    act(() => {
      useStore.setState({
        ...initialAIModelState,
        activeAiProvider: 'test-provider',
        refreshAiProviderRuntimeState: vi.fn(),
      });
    });
  });

  afterEach(async () => {
    await Promise.all(
      [...scopes].map((value) =>
        aiModelReasoningConfigResource.storage!.remove({
          queryKey: REASONING_STORAGE_KEY,
          scope: identityScopeOf(value),
        }),
      ),
    );
    scopes.clear();
    vi.restoreAllMocks();
  });

  describe('updateModelReasoningConfig', () => {
    it('should optimistically merge the value and persist it via the service', async () => {
      act(() => {
        useStore.setState({
          modelReasoningConfigMap: { 'openai/gpt-5.2': { reasoningMode: 'pro' } },
        });
      });

      const { result } = renderHook(() => useStore());
      const serviceSpy = vi
        .spyOn(aiModelService, 'updateAiModelReasoningConfig')
        .mockResolvedValue(undefined as any);

      await act(async () => {
        await result.current.updateModelReasoningConfig('gpt-5.2', 'openai', {
          reasoningEffort: 'high',
        });
      });

      expect(serviceSpy).toHaveBeenCalledWith('gpt-5.2', 'openai', {
        reasoningEffort: 'high',
      });
      // merged with the previous value, not replaced
      expect(useStore.getState().modelReasoningConfigMap['openai/gpt-5.2']).toEqual({
        reasoningEffort: 'high',
        reasoningMode: 'pro',
      });
      expect(useStore.getState().modelReasoningConfigUpdatingKeys).toEqual([]);
    });

    it('should refresh after clearing the updating marker and adopt the server-merged value', async () => {
      const { result } = renderHook(() => useStore());
      vi.spyOn(aiModelService, 'updateAiModelReasoningConfig').mockResolvedValue(undefined as any);

      // The replica drops responses while the key is marked updating, so
      // refreshing before the marker clears would discard the server-merged
      // config (sibling fields preserved by the partial write)
      const updatingKeysAtFetch: string[][] = [];
      vi.spyOn(aiModelService, 'getAiModelReasoningConfig').mockImplementation(async () => {
        updatingKeysAtFetch.push([...useStore.getState().modelReasoningConfigUpdatingKeys]);
        return { reasoningEffort: 'high', reasoningMode: 'pro' };
      });

      await act(async () => {
        await result.current.updateModelReasoningConfig('gpt-5.2', 'openai', {
          reasoningEffort: 'high',
        });
      });

      expect(updatingKeysAtFetch).toEqual([[]]);
      expect(useStore.getState().modelReasoningConfigMap['openai/gpt-5.2']).toEqual({
        reasoningEffort: 'high',
        reasoningMode: 'pro',
      });
    });

    it('persists the saved value so a reload paints it even when the refresh fails', async () => {
      const { result } = renderHook(() => useStore());
      vi.spyOn(aiModelService, 'updateAiModelReasoningConfig').mockResolvedValue(undefined as any);
      vi.spyOn(aiModelService, 'getAiModelReasoningConfig').mockRejectedValue(new Error('offline'));

      await act(async () => {
        await result.current.updateModelReasoningConfig('gpt-5.2', 'openai', {
          reasoningEffort: 'high',
        });
      });

      await waitFor(async () =>
        expect(
          (
            await aiModelReasoningConfigResource.storage!.get({
              queryKey: REASONING_STORAGE_KEY,
              scope: rowScope(),
            })
          )?.data,
        ).toEqual({ value: { reasoningEffort: 'high' } }),
      );
    });

    it('keeps a save that settles after a scope switch out of the new scope', async () => {
      vi.spyOn(aiModelService, 'getAiModelReasoningConfig').mockImplementation(pending);
      const sync = renderHook(
        () => useStore.getState().useFetchAiModelReasoningConfig('gpt-5.2', 'openai'),
        { wrapper },
      );
      let finishSave!: () => void;
      vi.spyOn(aiModelService, 'updateAiModelReasoningConfig').mockImplementation(
        () => new Promise((r) => (finishSave = () => r(undefined as any))),
      );
      const fetchSpy = vi
        .spyOn(aiModelService, 'getAiModelReasoningConfig')
        .mockResolvedValue({ reasoningEffort: 'low' });

      let saving!: Promise<void>;
      act(() => {
        saving = useStore.getState().updateModelReasoningConfig('gpt-5.2', 'openai', {
          reasoningEffort: 'high',
        });
      });

      // The account / workspace changes while the save is in flight
      useScope(`ai-model-user-${randomUUID()}:personal`);
      vi.spyOn(aiModelService, 'getAiModelReasoningConfig').mockImplementation(pending);
      sync.rerender();
      await waitFor(() =>
        expect('openai/gpt-5.2' in useStore.getState().modelReasoningConfigMap).toBe(false),
      );
      fetchSpy.mockClear();

      await act(async () => {
        finishSave();
        await saving;
      });

      expect('openai/gpt-5.2' in useStore.getState().modelReasoningConfigMap).toBe(false);
      expect(
        useStore.getState().modelReasoningConfigReplica.entries['openai/gpt-5.2'],
      ).toBeUndefined();
      expect(fetchSpy).not.toHaveBeenCalled();
      await new Promise((r) => setTimeout(r, 50));
      expect(
        await aiModelReasoningConfigResource.storage!.get({
          queryKey: REASONING_STORAGE_KEY,
          scope: rowScope(),
        }),
      ).toBeUndefined();
    });

    it('lets the new scope load the model while a save of the previous scope is in flight', async () => {
      vi.spyOn(aiModelService, 'getAiModelReasoningConfig').mockImplementation(pending);
      const sync = renderHook(
        () => useStore.getState().useFetchAiModelReasoningConfig('gpt-5.2', 'openai'),
        { wrapper },
      );
      vi.spyOn(aiModelService, 'updateAiModelReasoningConfig').mockImplementation(pending);
      act(() => {
        void useStore.getState().updateModelReasoningConfig('gpt-5.2', 'openai', {
          reasoningEffort: 'high',
        });
      });
      expect(useStore.getState().modelReasoningConfigUpdatingKeys).toEqual(['openai/gpt-5.2']);

      // Switch identity; the new scope's own config must land
      useScope(`ai-model-user-${randomUUID()}:personal`);
      vi.spyOn(aiModelService, 'getAiModelReasoningConfig').mockResolvedValue({
        reasoningEffort: 'low',
      });
      sync.rerender();

      await waitFor(() =>
        expect(useStore.getState().modelReasoningConfigMap['openai/gpt-5.2']).toEqual({
          reasoningEffort: 'low',
        }),
      );
      expect(useStore.getState().modelReasoningConfigUpdatingKeys).toEqual([]);
    });

    it('should rollback the optimistic value and toast on failure', async () => {
      act(() => {
        useStore.setState({
          modelReasoningConfigMap: { 'openai/gpt-5.2': { reasoningEffort: 'low' } },
        });
      });

      const { result } = renderHook(() => useStore());
      vi.spyOn(aiModelService, 'updateAiModelReasoningConfig').mockRejectedValue(
        new Error('Service error'),
      );

      await expect(async () => {
        await act(async () => {
          await result.current.updateModelReasoningConfig('gpt-5.2', 'openai', {
            reasoningEffort: 'high',
          });
        });
      }).rejects.toThrow('Service error');

      expect(useStore.getState().modelReasoningConfigMap['openai/gpt-5.2']).toEqual({
        reasoningEffort: 'low',
      });
      expect(useStore.getState().modelReasoningConfigUpdatingKeys).toEqual([]);
      expect(toast.error).toHaveBeenCalledWith(t('reasoningEffort.updateFailed', { ns: 'chat' }));
    });

    it('should drop the key on failed rollback when it was not cached before', async () => {
      const { result } = renderHook(() => useStore());
      vi.spyOn(aiModelService, 'updateAiModelReasoningConfig').mockRejectedValue(
        new Error('Service error'),
      );

      await expect(async () => {
        await act(async () => {
          await result.current.updateModelReasoningConfig('gpt-5.2', 'openai', {
            reasoningEffort: 'high',
          });
        });
      }).rejects.toThrow('Service error');

      // A leftover `[key]: undefined` would make ensureModelReasoningConfig
      // treat the key as cached and never fetch the saved server value
      expect('openai/gpt-5.2' in useStore.getState().modelReasoningConfigMap).toBe(false);
    });
  });

  describe('ensureModelReasoningConfig', () => {
    beforeEach(() => {
      vi.spyOn(aiModelSelectors, 'isModelHasReasoningControls').mockReturnValue(() => true);
      // Make the runtime-state warm-up a no-op so tests exercise the fetch logic
      act(() => {
        useStore.setState({ isInitAiProviderRuntimeState: true });
      });
    });

    it('should skip the fetch for models without reasoning extend params', async () => {
      vi.spyOn(aiModelSelectors, 'isModelHasReasoningControls').mockReturnValue(() => false);

      const { result } = renderHook(() => useStore());
      const serviceSpy = vi.spyOn(aiModelService, 'getAiModelReasoningConfig');

      await act(async () => {
        await result.current.ensureModelReasoningConfig('gpt-4o', 'openai');
      });

      expect(serviceSpy).not.toHaveBeenCalled();
    });

    it('should fetch and cache the config when the key is absent', async () => {
      const { result } = renderHook(() => useStore());
      const serviceSpy = vi
        .spyOn(aiModelService, 'getAiModelReasoningConfig')
        .mockResolvedValue({ reasoningEffort: 'high' });

      await act(async () => {
        await result.current.ensureModelReasoningConfig('gpt-5.2', 'openai');
      });

      expect(serviceSpy).toHaveBeenCalledWith('gpt-5.2', 'openai');
      expect(useStore.getState().modelReasoningConfigMap['openai/gpt-5.2']).toEqual({
        reasoningEffort: 'high',
      });
    });

    it('should keep the key for an empty config so it is not refetched', async () => {
      const { result } = renderHook(() => useStore());
      const serviceSpy = vi
        .spyOn(aiModelService, 'getAiModelReasoningConfig')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.ensureModelReasoningConfig('gpt-5.2', 'openai');
        await result.current.ensureModelReasoningConfig('gpt-5.2', 'openai');
      });

      expect(serviceSpy).toHaveBeenCalledTimes(1);
      expect('openai/gpt-5.2' in useStore.getState().modelReasoningConfigMap).toBe(true);
    });

    it('should not fetch when the config is already cached', async () => {
      act(() => {
        useStore.setState({
          modelReasoningConfigMap: { 'openai/gpt-5.2': { reasoningEffort: 'low' } },
        });
      });

      const { result } = renderHook(() => useStore());
      const serviceSpy = vi.spyOn(aiModelService, 'getAiModelReasoningConfig');

      await act(async () => {
        await result.current.ensureModelReasoningConfig('gpt-5.2', 'openai');
      });

      expect(serviceSpy).not.toHaveBeenCalled();
      expect(useStore.getState().modelReasoningConfigMap['openai/gpt-5.2']).toEqual({
        reasoningEffort: 'low',
      });
    });

    it('confirms a value only restored from the local replica before the send path uses it', async () => {
      await aiModelReasoningConfigResource.storage!.set(
        { queryKey: REASONING_STORAGE_KEY, scope: rowScope() },
        { data: { value: { reasoningEffort: 'low' } }, updatedAt: 1 },
      );
      let resolve!: (value: { reasoningEffort: 'high' }) => void;
      const serviceSpy = vi
        .spyOn(aiModelService, 'getAiModelReasoningConfig')
        .mockImplementation(() => new Promise((r) => (resolve = r)));
      renderHook(() => useStore.getState().useFetchAiModelReasoningConfig('gpt-5.2', 'openai'), {
        wrapper,
      });
      await waitFor(() =>
        expect(useStore.getState().modelReasoningConfigMap['openai/gpt-5.2']).toEqual({
          reasoningEffort: 'low',
        }),
      );

      // The stale copy is not trusted: ensure waits for the server answer
      let settled = false;
      const ensured = useStore
        .getState()
        .ensureModelReasoningConfig('gpt-5.2', 'openai')
        .then(() => (settled = true));
      await new Promise((r) => setTimeout(r, 20));
      expect(settled).toBe(false);

      await act(async () => {
        resolve({ reasoningEffort: 'high' });
        await ensured;
      });

      expect(serviceSpy).toHaveBeenCalledTimes(1);
      expect(useStore.getState().modelReasoningConfigMap['openai/gpt-5.2']).toEqual({
        reasoningEffort: 'high',
      });
    });

    it('should swallow fetch failures', async () => {
      const { result } = renderHook(() => useStore());
      vi.spyOn(aiModelService, 'getAiModelReasoningConfig').mockRejectedValue(
        new Error('Service error'),
      );

      await act(async () => {
        await expect(
          result.current.ensureModelReasoningConfig('gpt-5.2', 'openai'),
        ).resolves.toBeUndefined();
      });

      expect('openai/gpt-5.2' in useStore.getState().modelReasoningConfigMap).toBe(false);
    });
  });

  describe('useFetchAiModelReasoningConfig', () => {
    it('paints the persisted config before the network answers, then adopts the server value', async () => {
      await aiModelReasoningConfigResource.storage!.set(
        { queryKey: REASONING_STORAGE_KEY, scope: rowScope() },
        { data: { value: { reasoningEffort: 'low' } }, updatedAt: 1 },
      );
      let resolve!: (value: { reasoningEffort: 'high' }) => void;
      vi.spyOn(aiModelService, 'getAiModelReasoningConfig').mockImplementation(
        () => new Promise((r) => (resolve = r)),
      );

      const sync = renderHook(
        () => useStore.getState().useFetchAiModelReasoningConfig('gpt-5.2', 'openai'),
        { wrapper },
      );

      // First frame after a reload: the saved level, before any response
      await waitFor(() =>
        expect(useStore.getState().modelReasoningConfigMap['openai/gpt-5.2']).toEqual({
          reasoningEffort: 'low',
        }),
      );
      expect(sync.result.current.isHydrated).toBe(true);
      expect(
        aiModelSelectors.isModelReasoningConfigLoaded('gpt-5.2', 'openai')(useStore.getState()),
      ).toBe(true);

      await act(async () => resolve({ reasoningEffort: 'high' }));

      await waitFor(() =>
        expect(useStore.getState().modelReasoningConfigMap['openai/gpt-5.2']).toEqual({
          reasoningEffort: 'high',
        }),
      );
      await waitFor(async () =>
        expect(
          (
            await aiModelReasoningConfigResource.storage!.get({
              queryKey: REASONING_STORAGE_KEY,
              scope: rowScope(),
            })
          )?.data,
        ).toEqual({ value: { reasoningEffort: 'high' } }),
      );
    });

    it('repaints the saved config after a reload before the network answers', async () => {
      vi.spyOn(aiModelService, 'getAiModelReasoningConfig').mockResolvedValue({
        reasoningEffort: 'high',
      });
      const first = renderHook(
        () => useStore.getState().useFetchAiModelReasoningConfig('gpt-5.2', 'openai'),
        { wrapper },
      );
      await waitFor(() =>
        expect(useStore.getState().modelReasoningConfigMap['openai/gpt-5.2']).toEqual({
          reasoningEffort: 'high',
        }),
      );
      // let the confirmed value reach storage
      await new Promise((r) => setTimeout(r, 50));
      first.unmount();

      // Reload: a fresh store and query cache, and a network that has not answered
      act(() => {
        useStore.setState({ ...initialAIModelState });
      });
      vi.spyOn(aiModelService, 'getAiModelReasoningConfig').mockImplementation(pending);
      renderHook(() => useStore.getState().useFetchAiModelReasoningConfig('gpt-5.2', 'openai'), {
        wrapper,
      });

      await waitFor(() =>
        expect(useStore.getState().modelReasoningConfigMap['openai/gpt-5.2']).toEqual({
          reasoningEffort: 'high',
        }),
      );
    });

    it('should not fetch when model or provider is missing', () => {
      const serviceSpy = vi.spyOn(aiModelService, 'getAiModelReasoningConfig');

      renderHook(() => useStore.getState().useFetchAiModelReasoningConfig(undefined, 'openai'), {
        wrapper,
      });

      expect(serviceSpy).not.toHaveBeenCalled();
    });

    it('sends one request for every surface mounted on the same model', async () => {
      const serviceSpy = vi
        .spyOn(aiModelService, 'getAiModelReasoningConfig')
        .mockResolvedValue({ reasoningEffort: 'high' });

      // ChatInput loader, the Params sub-agent controls and the profile picker
      renderHook(
        () => {
          useStore.getState().useFetchAiModelReasoningConfig('gpt-5.2', 'openai');
          useStore.getState().useFetchAiModelReasoningConfig('gpt-5.2', 'openai');
          useStore.getState().useFetchAiModelReasoningConfig('gpt-5.2', 'openai');
        },
        { wrapper: withSWR },
      );

      await waitFor(() =>
        expect(useStore.getState().modelReasoningConfigMap['openai/gpt-5.2']).toEqual({
          reasoningEffort: 'high',
        }),
      );
      expect(serviceSpy).toHaveBeenCalledTimes(1);
    });

    it('keeps the last saved value when the refresh fails', async () => {
      await aiModelReasoningConfigResource.storage!.set(
        { queryKey: REASONING_STORAGE_KEY, scope: rowScope() },
        { data: { value: { reasoningEffort: 'low' } }, updatedAt: 1 },
      );
      const serviceSpy = vi
        .spyOn(aiModelService, 'getAiModelReasoningConfig')
        .mockRejectedValue(new Error('offline'));

      renderHook(() => useStore.getState().useFetchAiModelReasoningConfig('gpt-5.2', 'openai'), {
        wrapper,
      });

      await waitFor(() => expect(serviceSpy).toHaveBeenCalled());
      await waitFor(() =>
        expect(useStore.getState().modelReasoningConfigMap['openai/gpt-5.2']).toEqual({
          reasoningEffort: 'low',
        }),
      );
    });

    it("never shows the previous identity's saved config after a scope switch", async () => {
      const scopeA = scope;
      await aiModelReasoningConfigResource.storage!.set(
        { queryKey: REASONING_STORAGE_KEY, scope: rowScope(scopeA) },
        { data: { value: { reasoningEffort: 'low' } }, updatedAt: 1 },
      );
      vi.spyOn(aiModelService, 'getAiModelReasoningConfig').mockImplementation(pending);

      const sync = renderHook(
        () => useStore.getState().useFetchAiModelReasoningConfig('gpt-5.2', 'openai'),
        { wrapper },
      );
      await waitFor(() =>
        expect(useStore.getState().modelReasoningConfigMap['openai/gpt-5.2']).toEqual({
          reasoningEffort: 'low',
        }),
      );

      useScope(`ai-model-user-${randomUUID()}:personal`);
      sync.rerender();

      await waitFor(() =>
        expect('openai/gpt-5.2' in useStore.getState().modelReasoningConfigMap).toBe(false),
      );
      expect(
        aiModelSelectors.isModelReasoningConfigLoaded('gpt-5.2', 'openai')(useStore.getState()),
      ).toBe(false);
    });

    it('should not clobber an in-flight optimistic value', async () => {
      act(() => {
        useStore.setState({
          modelReasoningConfigMap: { 'openai/gpt-5.2': { reasoningEffort: 'high' } },
          modelReasoningConfigUpdatingKeys: ['openai/gpt-5.2'],
        });
      });

      vi.spyOn(aiModelService, 'getAiModelReasoningConfig').mockResolvedValue({
        reasoningEffort: 'low',
      });

      renderHook(() => useStore.getState().useFetchAiModelReasoningConfig('gpt-5.2', 'openai'), {
        wrapper,
      });

      await waitFor(() => {
        expect(aiModelService.getAiModelReasoningConfig).toHaveBeenCalled();
      });

      expect(useStore.getState().modelReasoningConfigMap['openai/gpt-5.2']).toEqual({
        reasoningEffort: 'high',
      });
    });

    it('settles a model with nothing saved as a loaded, undefined config', async () => {
      // The server legitimately returns nothing when the user never customized
      // this model's reasoning params; the key still counts as settled.
      vi.spyOn(aiModelService, 'getAiModelReasoningConfig').mockResolvedValue(undefined);

      renderHook(
        () => useStore.getState().useFetchAiModelReasoningConfig('test-model', 'test-provider'),
        { wrapper },
      );

      await waitFor(() =>
        expect(
          aiModelSelectors.isModelReasoningConfigLoaded(
            'test-model',
            'test-provider',
          )(useStore.getState()),
        ).toBe(true),
      );
      expect(aiModelService.getAiModelReasoningConfig).toHaveBeenCalledTimes(1);
      expect(
        useStore.getState().modelReasoningConfigMap['test-provider/test-model'],
      ).toBeUndefined();
    });
  });

  describe('seedModelReasoningConfigs', () => {
    it('seeds the snapshot as confirmed entries and keeps an in-flight save', () => {
      act(() => {
        useStore.setState({
          modelReasoningConfigMap: { 'openai/gpt-5.2': { reasoningEffort: 'high' } },
          modelReasoningConfigUpdatingKeys: ['openai/gpt-5.2'],
        });
      });

      act(() => {
        useStore
          .getState()
          .seedModelReasoningConfigs(
            { 'anthropic/claude-sonnet-4-5': { reasoningEffort: 'low' } },
            [
              { id: 'gpt-5.2', providerId: 'openai' },
              { id: 'claude-sonnet-4-5', providerId: 'anthropic' },
            ] as any,
          );
      });

      const state = useStore.getState();
      // A save in flight keeps its optimistic value and gets no replica entry.
      expect(state.modelReasoningConfigMap['openai/gpt-5.2']).toEqual({ reasoningEffort: 'high' });
      expect(state.modelReasoningConfigReplica.entries['openai/gpt-5.2']).toBeUndefined();
      // The server's snapshot lands as a confirmed entry, so a hydration still
      // in flight cannot repaint an older persisted row over it.
      expect(state.modelReasoningConfigMap['anthropic/claude-sonnet-4-5']).toEqual({
        reasoningEffort: 'low',
      });
      expect(
        state.modelReasoningConfigReplica.entries['anthropic/claude-sonnet-4-5'],
      ).toBeDefined();
    });
  });
});
