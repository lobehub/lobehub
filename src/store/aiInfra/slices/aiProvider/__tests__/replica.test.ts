import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppIndexedDBStorage } from '@/libs/replica';
import { aiProviderSelectors, useAiInfraStore as useStore } from '@/store/aiInfra';
import { initialAIModelState } from '@/store/aiInfra/slices/aiModel/initialState';
import type {
  AiProviderDetailItem,
  AiProviderListItem,
  AiProviderRuntimeState,
} from '@/types/aiProvider';

import { initialAIProviderState } from '../initialState';
import {
  AI_PROVIDER_LIST_KEY,
  aiProviderDetailResource,
  aiProviderListResource,
  aiProviderRuntimeStateQueryKey,
  aiProviderRuntimeStateResource,
  type AiProviderRuntimeStateView,
} from '../projection';

vi.mock('@/services/aiProvider', () => ({
  aiProviderService: {
    getAiProviderDetail: vi.fn(),
    getAiProviderList: vi.fn(),
    getAiProviderRuntimeState: vi.fn(),
    deleteAiProvider: vi.fn(async () => undefined),
    toggleProviderEnabled: vi.fn(async () => undefined),
  },
}));

// The runtime-state fetcher combines the server rows with the bundled model
// bank; both are stubbed so the fetch stays a pure unit under test.
vi.mock('model-bank/modelProviders', () => ({ DEFAULT_MODEL_PROVIDER_LIST: [] }));
vi.mock('@/business/client/model-bank/loadModels', () => ({
  loadDefaultHiddenBuiltinModels: vi.fn(async () => []),
  loadModels: vi.fn(async () => []),
}));

// The replica schedules its fetches through the app's SWR driver; the engine
// itself is what these tests exercise, so the driver is a bare recorder.
vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(() => ({ isValidating: false, mutate: vi.fn() })),
}));

let authLoaded = true;
vi.mock('@/store/user', () => ({ useUserStore: vi.fn(() => authLoaded) }));

// Partition the replica memory by a fixed scope, so the tests do not depend on
// the signed-in user / workspace resolution.
vi.mock('@/libs/swr/useCacheScope', () => ({
  getCacheScope: () => 'test-scope',
  isScopeTrusted: () => true,
  useCacheScope: () => 'test-scope',
}));

const makeProvider = (id = 'openai'): AiProviderListItem => ({
  enabled: true,
  id,
  name: id,
  source: 'builtin' as any,
});

const makeDetail = (id = 'openai'): AiProviderDetailItem =>
  ({ id, name: id, settings: {} }) as AiProviderDetailItem;

const resetStore = () =>
  useStore.setState({
    ...initialAIProviderState,
    ...initialAIModelState,
  });

const SCOPE = 'test-scope';
const readPersistedList = async () =>
  (await aiProviderListResource.storage!.get({ queryKey: AI_PROVIDER_LIST_KEY, scope: SCOPE }))
    ?.data;

const RUNTIME_STATE_ROW = {
  queryKey: aiProviderRuntimeStateResource.storageKey({ isLogin: true }),
  scope: SCOPE,
};
const rawRuntimeStateStorage = new AppIndexedDBStorage<any>({
  namespace: 'replica:aiProviderRuntimeState:v2',
});

beforeEach(async () => {
  vi.clearAllMocks();
  authLoaded = true;
  resetStore();
  await aiProviderListResource.storage!.remove({ queryKey: AI_PROVIDER_LIST_KEY, scope: SCOPE });
  await rawRuntimeStateStorage.remove(RUNTIME_STATE_ROW);
});

/** Confirm a server list through the mounted sync, which also persists it. */
const confirmList = async (list: AiProviderListItem[]) => {
  renderHook(() => useStore.getState().useFetchAiProviderList());
  const [call] = await syncCalls('aiProviderList');
  act(() => call.config.onSuccess!(list));
  await vi.waitFor(async () => expect(await readPersistedList()).toEqual(list));
};

/** The replica network syncs registered with the SWR driver, per resource name. */
const syncCalls = async (
  name: 'aiProviderList' | 'aiProviderDetail' | 'aiProviderRuntimeState',
) => {
  const { useClientDataSWR } = await import('@/libs/swr');
  return vi
    .mocked(useClientDataSWR)
    .mock.calls.filter(
      ([key]) => Array.isArray(key) && key[0] === 'replica:sync' && key[1] === name,
    )
    .map(([key, fetcher, config]) => ({
      config: config as { onSuccess?: (data: unknown) => void },
      fetcher: fetcher as () => Promise<any>,
      key: key as unknown[],
    }));
};

describe('AiProviderSlice (replica)', () => {
  describe('persistence policy', () => {
    it('keeps the provider detail memory-only', () => {
      // The detail carries decrypted `keyVaults`. Omitting `storage` is NOT
      // memory-only — the app wrapper defaults to IndexedDB — so this guards
      // the explicit `storage: 'memory'`.
      expect(aiProviderListResource.persisted).toBe(true);
      expect(aiProviderDetailResource.persisted).toBe(false);
      expect(aiProviderRuntimeStateResource.persisted).toBe(true);
    });
  });

  describe('useFetchAiProviderList', () => {
    it('fetches the secret-free provider list through the service', async () => {
      const { aiProviderService } = await import('@/services/aiProvider');

      renderHook(() => useStore.getState().useFetchAiProviderList());

      const [call] = await syncCalls('aiProviderList');
      expect(call).toBeDefined();
      await call.fetcher();

      expect(aiProviderService.getAiProviderList).toHaveBeenCalledTimes(1);
    });

    it('registers no sync when disabled', async () => {
      renderHook(() => useStore.getState().useFetchAiProviderList({ enabled: false }));

      expect(await syncCalls('aiProviderList')).toHaveLength(0);
    });

    it('folds the response onto the flat list and flips initAiProviderList', async () => {
      const list = [makeProvider('acme')];

      renderHook(() => useStore.getState().useFetchAiProviderList());
      const [call] = await syncCalls('aiProviderList');
      act(() => call.config.onSuccess!(list));

      expect(useStore.getState().aiProviderList).toEqual(list);
      expect(useStore.getState().initAiProviderList).toBe(true);
    });

    it('reflects an enable toggle in the list without waiting for the refresh', async () => {
      useStore.setState({ aiProviderList: [makeProvider('acme')], initAiProviderList: true });

      await useStore.getState().toggleProviderEnabled('acme', false);

      const { aiProviderService } = await import('@/services/aiProvider');
      expect(aiProviderService.toggleProviderEnabled).toHaveBeenCalledWith('acme', false);
      expect(aiProviderSelectors.enabledAiProviderList(useStore.getState())).toHaveLength(0);
    });
  });

  describe('confirmed list writes', () => {
    it('persists a confirmed enable toggle even when the list refresh does not land', async () => {
      await confirmList([makeProvider('acme'), makeProvider('other')]);

      // The refresh is a no-op here (the SWR driver is a recorder), standing in
      // for a revalidation that fails after the server confirmed the toggle.
      await useStore.getState().toggleProviderEnabled('acme', false);

      await vi.waitFor(async () =>
        expect(await readPersistedList()).toEqual([
          { ...makeProvider('acme'), enabled: false },
          makeProvider('other'),
        ]),
      );
    });

    it('drops a deleted provider from the persisted list', async () => {
      await confirmList([makeProvider('acme'), makeProvider('other')]);

      await useStore.getState().deleteAiProvider('acme');

      expect(useStore.getState().aiProviderList.map((item) => item.id)).toEqual(['other']);
      await vi.waitFor(async () =>
        expect(await readPersistedList()).toEqual([makeProvider('other')]),
      );
    });
  });

  describe('useFetchAiProviderItem', () => {
    it('folds the detail into the map and adopts it as the active provider', async () => {
      const detail = makeDetail('openai');

      renderHook(() => useStore.getState().useFetchAiProviderItem('openai'));
      const [call] = await syncCalls('aiProviderDetail');
      act(() => call.config.onSuccess!(detail));

      expect(aiProviderSelectors.providerDetailById('openai')(useStore.getState())).toEqual(detail);
      expect(useStore.getState().activeAiProvider).toBe('openai');
    });

    it('drops a cached detail when the server no longer has the id', async () => {
      useStore.setState({
        activeAiProvider: 'openai',
        aiProviderDetailMap: { openai: makeDetail('openai') },
      });

      renderHook(() => useStore.getState().useFetchAiProviderItem('openai'));
      const [call] = await syncCalls('aiProviderDetail');
      act(() => call.config.onSuccess!(undefined));

      expect(useStore.getState().aiProviderDetailMap.openai).toBeUndefined();
    });
  });

  describe('useFetchAiProviderRuntimeState', () => {
    const runtimeState = (): AiProviderRuntimeState & {
      builtinAiModelList: any[];
      enabledChatModelList: any[];
    } => ({
      builtinAiModelList: [{ id: 'gpt-4o', providerId: 'openai', type: 'chat' }],
      enabledAiModels: [{ id: 'gpt-4o', providerId: 'openai', type: 'chat' }] as any,
      enabledAiProviders: [{ id: 'openai', source: 'builtin' }] as any,
      enabledChatAiProviders: [],
      enabledChatModelList: [{ children: [], id: 'openai', name: 'OpenAI' }] as any,
      enabledImageAiProviders: [],
      enabledVideoAiProviders: [],
      runtimeConfig: { openai: { keyVaults: { apiKey: 'sk-live' } } } as any,
    });

    it('fetches the signed-in entry and projects it onto the flat fields', async () => {
      const value = runtimeState();

      renderHook(() => useStore.getState().useFetchAiProviderRuntimeState(true));
      const [call] = await syncCalls('aiProviderRuntimeState');
      act(() => call.config.onSuccess!(value));

      const state = useStore.getState();
      expect(state.isInitAiProviderRuntimeState).toBe(true);
      expect(state.builtinAiModelList).toEqual(value.builtinAiModelList);
      expect(state.enabledAiModels).toEqual(value.enabledAiModels);
      expect(state.enabledChatModelList).toEqual(value.enabledChatModelList);
      expect(state.aiProviderRuntimeConfig).toEqual(value.runtimeConfig);
      expect(
        state.aiProviderRuntimeStateMap[aiProviderRuntimeStateQueryKey({ isLogin: true })],
      ).toEqual(value);
    });

    it('seeds the saved reasoning configs through the aiModel replica', async () => {
      const value: AiProviderRuntimeStateView = {
        ...runtimeState(),
        modelReasoningConfigs: { 'openai/gpt-4o': { reasoningEffort: 'low' } },
      };

      renderHook(() => useStore.getState().useFetchAiProviderRuntimeState(true));
      const [call] = await syncCalls('aiProviderRuntimeState');
      act(() => call.config.onSuccess!(value));

      const state = useStore.getState();
      expect(state.modelReasoningConfigMap['openai/gpt-4o']).toEqual({ reasoningEffort: 'low' });
      // Seeded as a *confirmed* replica entry, not a bare map write: only then
      // does a storage hydration that resolves later leave it alone instead of
      // repainting an older persisted row over the server's value.
      expect(state.modelReasoningConfigReplica.entries['openai/gpt-4o']).toBeDefined();
    });

    it('does not seed reasoning configs from a display snapshot', async () => {
      const value: AiProviderRuntimeStateView = {
        ...runtimeState(),
        isDisplaySnapshot: true,
        modelReasoningConfigs: { 'openai/gpt-4o': { reasoningEffort: 'low' } },
      };

      renderHook(() => useStore.getState().useFetchAiProviderRuntimeState(true));
      const [call] = await syncCalls('aiProviderRuntimeState');
      act(() => call.config.onSuccess!(value));

      expect(useStore.getState().modelReasoningConfigMap['openai/gpt-4o']).toBeUndefined();
    });

    it('persists only the secret-free display fields of a confirmed value', async () => {
      const value = {
        ...runtimeState(),
        enabledChatModelList: [{ children: [], id: 'anthropic', name: 'Anthropic' }],
      };

      renderHook(() => useStore.getState().useFetchAiProviderRuntimeState(true));
      const [call] = await syncCalls('aiProviderRuntimeState');
      act(() => call.config.onSuccess!(value));

      await vi.waitFor(async () =>
        expect(await rawRuntimeStateStorage.get(RUNTIME_STATE_ROW)).toBeDefined(),
      );
      const row = await rawRuntimeStateStorage.get(RUNTIME_STATE_ROW);
      expect(JSON.stringify(row)).not.toContain('sk-live');
      expect(row!.data.runtimeConfig).toEqual({});
      expect(row!.data.enabledChatModelList).toEqual(value.enabledChatModelList);
    });

    it('paints the model lists from storage without marking the runtime state ready', async () => {
      await rawRuntimeStateStorage.set(RUNTIME_STATE_ROW, {
        data: runtimeState(),
        updatedAt: Date.now(),
      });

      renderHook(() => useStore.getState().useFetchAiProviderRuntimeState(true));
      const { useClientDataSWR } = await import('@/libs/swr');
      const hydrate = vi
        .mocked(useClientDataSWR)
        .mock.calls.find(
          ([key]) =>
            Array.isArray(key) &&
            key[0] === 'replica:hydrate' &&
            key[1] === 'aiProviderRuntimeState',
        );
      await act(async () => {
        await (hydrate![1] as () => Promise<unknown>)();
      });

      expect(useStore.getState().enabledChatModelList).toEqual(runtimeState().enabledChatModelList);
      const state = useStore.getState();
      expect(state.enabledAiModels).toEqual(runtimeState().enabledAiModels);
      expect(state.isInitAiProviderRuntimeState).toBe(false);
      expect(state.aiProviderRuntimeConfig).toEqual({});
      expect(state.builtinAiModelList).toEqual(initialAIModelState.builtinAiModelList);
    });

    it('does not register a sync until auth has loaded', async () => {
      authLoaded = false;

      renderHook(() => useStore.getState().useFetchAiProviderRuntimeState(true));

      expect(await syncCalls('aiProviderRuntimeState')).toHaveLength(0);
    });

    it('keys the signed-in and signed-out entries separately', async () => {
      const { result } = renderHook(() => [
        useStore.getState().useFetchAiProviderRuntimeState(true),
        useStore.getState().useFetchAiProviderRuntimeState(false),
      ]);

      // Two distinct replica keys → two distinct sync entries.
      expect(await syncCalls('aiProviderRuntimeState')).toHaveLength(2);
      expect(result.current).toHaveLength(2);
    });
  });
});
