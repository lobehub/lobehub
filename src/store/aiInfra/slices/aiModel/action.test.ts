import { toast } from '@lobehub/ui/base-ui';
import { act, renderHook, waitFor } from '@testing-library/react';
import type * as I18nextModule from 'i18next';
import { t } from 'i18next';
import type { AiProviderModelListItem } from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as SwrModule from '@/libs/swr';
import { mutate } from '@/libs/swr';
import { aiModelService } from '@/services/aiModel';
import { withSWR } from '~test-utils';

import { useAiInfraStore as useStore } from '../../store';
import { aiModelSelectors } from './selectors';

vi.mock('zustand/traditional');

vi.mock('i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof I18nextModule>();
  return {
    ...actual,
    t: vi.fn((key: string) => key),
  };
});

vi.mock('@lobehub/ui/base-ui', () => ({
  toast: { error: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/libs/swr', async (importOriginal) => {
  const actual = await importOriginal<typeof SwrModule>();
  return {
    ...actual,
    mutate: vi.fn(),
  };
});

beforeEach(() => {
  vi.clearAllMocks();

  // Reset store to initial state
  act(() => {
    useStore.setState({
      activeAiProvider: 'test-provider',
      aiModelLoadingIds: [],
      aiProviderModelList: [],
      isAiModelListInit: false,
      modelReasoningConfigMap: {},
      modelReasoningConfigUpdatingKeys: [],
      refreshAiProviderRuntimeState: vi.fn(),
    });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AiModelAction', () => {
  describe('batchToggleAiModels', () => {
    it('should toggle multiple models and refresh list', async () => {
      const { result } = renderHook(() => useStore());
      const refreshSpy = vi
        .spyOn(result.current, 'refreshAiModelList')
        .mockResolvedValue(undefined);
      const serviceSpy = vi
        .spyOn(aiModelService, 'batchToggleAiModels')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.batchToggleAiModels(['model-1', 'model-2'], true);
      });

      expect(serviceSpy).toHaveBeenCalledWith('test-provider', ['model-1', 'model-2'], true);
      expect(refreshSpy).toHaveBeenCalled();
    });

    it('should not toggle when no active provider', async () => {
      act(() => {
        useStore.setState({ activeAiProvider: undefined });
      });

      const { result } = renderHook(() => useStore());
      const serviceSpy = vi
        .spyOn(aiModelService, 'batchToggleAiModels')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.batchToggleAiModels(['model-1'], true);
      });

      expect(serviceSpy).not.toHaveBeenCalled();
    });
  });

  describe('batchUpdateAiModels', () => {
    it('should batch update models and refresh list', async () => {
      const models: AiProviderModelListItem[] = [
        {
          abilities: {},
          displayName: 'Model 1',
          enabled: true,
          id: 'model-1',
          source: 'builtin',
          type: 'chat',
        } as AiProviderModelListItem,
        {
          abilities: {},
          displayName: 'Model 2',
          enabled: false,
          id: 'model-2',
          source: 'builtin',
          type: 'chat',
        } as AiProviderModelListItem,
      ];

      const { result } = renderHook(() => useStore());
      const refreshSpy = vi
        .spyOn(result.current, 'refreshAiModelList')
        .mockResolvedValue(undefined);
      const serviceSpy = vi
        .spyOn(aiModelService, 'batchUpdateAiModels')
        .mockResolvedValue(undefined as any);

      await act(async () => {
        await result.current.batchUpdateAiModels(models);
      });

      expect(serviceSpy).toHaveBeenCalledWith('test-provider', models);
      expect(refreshSpy).toHaveBeenCalled();
    });

    it('should not update when no active provider', async () => {
      act(() => {
        useStore.setState({ activeAiProvider: undefined });
      });

      const { result } = renderHook(() => useStore());
      const serviceSpy = vi
        .spyOn(aiModelService, 'batchUpdateAiModels')
        .mockResolvedValue(undefined as any);

      await act(async () => {
        await result.current.batchUpdateAiModels([]);
      });

      expect(serviceSpy).not.toHaveBeenCalled();
    });
  });

  describe('clearModelsByProvider', () => {
    it('should clear all models for provider and refresh list', async () => {
      const { result } = renderHook(() => useStore());
      const refreshSpy = vi
        .spyOn(result.current, 'refreshAiModelList')
        .mockResolvedValue(undefined);
      const serviceSpy = vi
        .spyOn(aiModelService, 'clearModelsByProvider')
        .mockResolvedValue(undefined as any);

      await act(async () => {
        await result.current.clearModelsByProvider('test-provider');
      });

      expect(serviceSpy).toHaveBeenCalledWith('test-provider');
      expect(refreshSpy).toHaveBeenCalled();
    });
  });

  describe('clearRemoteModels', () => {
    it('should clear remote models for provider and refresh list', async () => {
      const { result } = renderHook(() => useStore());
      const refreshSpy = vi
        .spyOn(result.current, 'refreshAiModelList')
        .mockResolvedValue(undefined);
      const serviceSpy = vi
        .spyOn(aiModelService, 'clearRemoteModels')
        .mockResolvedValue(undefined as any);

      await act(async () => {
        await result.current.clearRemoteModels('test-provider');
      });

      expect(serviceSpy).toHaveBeenCalledWith('test-provider');
      expect(refreshSpy).toHaveBeenCalled();
    });
  });

  describe('createNewAiModel', () => {
    it('should create new model and refresh list', async () => {
      const params = {
        displayName: 'New Model',
        enabled: true,
        id: 'new-model',
        providerId: 'test-provider',
      };

      const { result } = renderHook(() => useStore());
      const refreshSpy = vi
        .spyOn(result.current, 'refreshAiModelList')
        .mockResolvedValue(undefined);
      const serviceSpy = vi
        .spyOn(aiModelService, 'createAiModel')
        .mockResolvedValue(undefined as any);

      await act(async () => {
        await result.current.createNewAiModel(params);
      });

      expect(serviceSpy).toHaveBeenCalledWith(params);
      expect(refreshSpy).toHaveBeenCalled();
    });
  });

  describe('fetchRemoteModelList', () => {
    it('should fetch remote models and batch update', async () => {
      const mockRemoteModels = [
        {
          displayName: 'Remote Model 1',
          enabled: true,
          files: true,
          functionCall: true,
          id: 'remote-1',
          type: 'chat',
          vision: false,
        },
        {
          displayName: 'Remote Model 2',
          enabled: false,
          id: 'remote-2',
          imageOutput: true,
          type: 'image',
        },
      ];

      const { result } = renderHook(() => useStore());
      const batchUpdateSpy = vi
        .spyOn(aiModelService, 'batchUpdateAiModels')
        .mockResolvedValue(undefined as any);
      const refreshSpy = vi
        .spyOn(result.current, 'refreshAiModelList')
        .mockResolvedValue(undefined);

      // Mock dynamic import
      vi.resetModules();
      vi.doMock('@/services/models', () => ({
        modelsService: {
          getModels: vi.fn().mockResolvedValue(mockRemoteModels),
        },
      }));

      await act(async () => {
        await result.current.fetchRemoteModelList('test-provider');
      });

      await waitFor(() => {
        expect(batchUpdateSpy).toHaveBeenCalled();
      });

      expect(batchUpdateSpy).toHaveBeenCalledWith('test-provider', expect.any(Array));
      const batchUpdateArg = batchUpdateSpy.mock.calls[0][1];
      expect(batchUpdateArg).toHaveLength(2);
      expect(batchUpdateArg[0]).toMatchObject({
        abilities: {
          files: true,
          functionCall: true,
          vision: false,
        },
        displayName: 'Remote Model 1',
        enabled: true,
        id: 'remote-1',
        source: 'remote',
        type: 'chat',
      });
      expect(batchUpdateArg[1]).toMatchObject({
        abilities: {
          imageOutput: true,
        },
        displayName: 'Remote Model 2',
        enabled: false,
        id: 'remote-2',
        source: 'remote',
        type: 'image',
      });
      expect(refreshSpy).toHaveBeenCalledTimes(1);
      expect(toast.warning).not.toHaveBeenCalled();
    });

    it('should deduplicate remote models and warn after a successful update', async () => {
      const generatedImageModelId = 'gemini-3.1-flash-image-preview:image';
      const mockRemoteModels = [
        {
          displayName: 'Gemini Base',
          id: 'gemini-3.1-flash-image-preview',
          type: 'chat',
        },
        {
          displayName: 'Provider Image Model',
          id: generatedImageModelId,
          type: 'image',
        },
        { displayName: 'KoboldCpp First', id: 'koboldcpp', type: 'chat' },
        { displayName: 'KoboldCpp Second', id: 'koboldcpp', type: 'chat' },
        { displayName: 'Duplicate Two First', id: 'duplicate-two', type: 'chat' },
        { displayName: 'Duplicate Two Second', id: 'duplicate-two', type: 'chat' },
        { displayName: 'Duplicate Three First', id: 'duplicate-three', type: 'chat' },
        { displayName: 'Duplicate Three Second', id: 'duplicate-three', type: 'chat' },
        {
          displayName: 'LobeHub Image Model',
          id: generatedImageModelId,
          type: 'image',
        },
      ];

      const { result } = renderHook(() => useStore());
      const batchUpdateSpy = vi
        .spyOn(aiModelService, 'batchUpdateAiModels')
        .mockResolvedValue(undefined as any);
      const refreshSpy = vi
        .spyOn(result.current, 'refreshAiModelList')
        .mockResolvedValue(undefined);

      vi.resetModules();
      vi.doMock('@/services/models', () => ({
        modelsService: {
          getModels: vi.fn().mockResolvedValue(mockRemoteModels),
        },
      }));

      await act(async () => {
        await result.current.fetchRemoteModelList('test-provider');
      });

      const batchUpdateArg = batchUpdateSpy.mock.calls[0][1];
      expect(batchUpdateArg).toHaveLength(5);
      expect(batchUpdateArg.find(({ id }) => id === 'koboldcpp')?.displayName).toBe(
        'KoboldCpp First',
      );
      expect(batchUpdateArg.find(({ id }) => id === generatedImageModelId)?.displayName).toBe(
        'LobeHub Image Model',
      );
      expect(t).toHaveBeenCalledWith('providerModels.list.fetcher.duplicatesRemovedWithMore', {
        count: 4,
        ids: 'koboldcpp, duplicate-two, duplicate-three',
        ns: 'modelProvider',
        remainingCount: 1,
      });
      expect(toast.warning).toHaveBeenCalledWith(
        'providerModels.list.fetcher.duplicatesRemovedWithMore',
      );
      expect(refreshSpy).toHaveBeenCalledTimes(1);
    });

    it('should not warn when updating deduplicated models fails', async () => {
      const mockRemoteModels = [
        { id: 'duplicate-model', type: 'chat' },
        { id: 'duplicate-model', type: 'chat' },
      ];

      const { result } = renderHook(() => useStore());
      vi.spyOn(aiModelService, 'batchUpdateAiModels').mockRejectedValue(
        new Error('batch update failed'),
      );

      vi.resetModules();
      vi.doMock('@/services/models', () => ({
        modelsService: {
          getModels: vi.fn().mockResolvedValue(mockRemoteModels),
        },
      }));

      await expect(async () => {
        await act(async () => {
          await result.current.fetchRemoteModelList('test-provider');
        });
      }).rejects.toThrow('batch update failed');

      expect(toast.warning).not.toHaveBeenCalled();
    });

    it('should preserve enabled status of existing models when fetching', async () => {
      const mockRemoteModels = [
        {
          displayName: 'Remote Model 1',
          id: 'remote-1',
          enabled: true,
          type: 'chat',
        },
        {
          displayName: 'Remote Model 2',
          id: 'remote-2',
          enabled: false,
          type: 'chat',
        },
      ];

      act(() => {
        useStore.setState({
          aiProviderModelList: [
            {
              id: 'remote-1',
              enabled: false,
              type: 'chat',
            },
            {
              id: 'remote-2',
              enabled: true,
              type: 'chat',
            },
          ],
        });
      });

      const { result } = renderHook(() => useStore());
      const batchUpdateSpy = vi
        .spyOn(aiModelService, 'batchUpdateAiModels')
        .mockResolvedValue(undefined as any);

      vi.doMock('@/services/models', () => ({
        modelsService: {
          getModels: vi.fn().mockResolvedValue(mockRemoteModels),
        },
      }));

      await act(async () => {
        await result.current.fetchRemoteModelList('test-provider');
      });

      await waitFor(() => {
        expect(batchUpdateSpy).toHaveBeenCalled();
      });

      const batchUpdateArg = batchUpdateSpy.mock.calls[0][1];
      expect(batchUpdateArg[0]).toMatchObject({
        id: 'remote-1',
        enabled: false,
      });
      expect(batchUpdateArg[1]).toMatchObject({
        id: 'remote-2',
        enabled: true,
      });
    });

    it('should not update if remote service returns no data', async () => {
      const { result } = renderHook(() => useStore());
      const batchUpdateSpy = vi
        .spyOn(result.current, 'batchUpdateAiModels')
        .mockResolvedValue(undefined);

      // Mock dynamic import with null response
      vi.resetModules();
      vi.doMock('@/services/models', () => ({
        modelsService: {
          getModels: vi.fn().mockResolvedValue(null),
        },
      }));

      await act(async () => {
        await result.current.fetchRemoteModelList('test-provider');
      });

      expect(batchUpdateSpy).not.toHaveBeenCalled();
    });

    it('should propagate remote service errors', async () => {
      const { result } = renderHook(() => useStore());
      const batchUpdateSpy = vi
        .spyOn(result.current, 'batchUpdateAiModels')
        .mockResolvedValue(undefined);

      vi.resetModules();
      vi.doMock('@/services/models', () => ({
        modelsService: {
          getModels: vi.fn().mockRejectedValue(new Error('model fetch failed')),
        },
      }));

      await expect(async () => {
        await act(async () => {
          await result.current.fetchRemoteModelList('test-provider');
        });
      }).rejects.toThrow('model fetch failed');

      expect(batchUpdateSpy).not.toHaveBeenCalled();
    });
  });

  describe('internal_toggleAiModelLoading', () => {
    it('should add model id to loading list when loading is true', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        result.current.internal_toggleAiModelLoading('model-1', true);
      });

      expect(result.current.aiModelLoadingIds).toContain('model-1');
    });

    it('should remove model id from loading list when loading is false', () => {
      act(() => {
        useStore.setState({ aiModelLoadingIds: ['model-1', 'model-2'] });
      });

      const { result } = renderHook(() => useStore());

      act(() => {
        result.current.internal_toggleAiModelLoading('model-1', false);
      });

      expect(result.current.aiModelLoadingIds).not.toContain('model-1');
      expect(result.current.aiModelLoadingIds).toContain('model-2');
    });

    it('should handle multiple loading states', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        result.current.internal_toggleAiModelLoading('model-1', true);
        result.current.internal_toggleAiModelLoading('model-2', true);
      });

      expect(result.current.aiModelLoadingIds).toEqual(['model-1', 'model-2']);

      act(() => {
        result.current.internal_toggleAiModelLoading('model-1', false);
      });

      expect(result.current.aiModelLoadingIds).toEqual(['model-2']);
    });
  });

  describe('refreshAiModelList', () => {
    it('should call mutate with correct key and trigger runtime state refresh', async () => {
      const { result } = renderHook(() => useStore());
      const refreshRuntimeSpy = vi
        .spyOn(result.current, 'refreshAiProviderRuntimeState')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.refreshAiModelList();
      });

      expect(mutate).toHaveBeenCalledWith(['aiModel:list', 'test-provider']);
      expect(refreshRuntimeSpy).toHaveBeenCalled();
    });
  });

  describe('removeAiModel', () => {
    it('should delete model and refresh list', async () => {
      const { result } = renderHook(() => useStore());
      const refreshSpy = vi
        .spyOn(result.current, 'refreshAiModelList')
        .mockResolvedValue(undefined);
      const serviceSpy = vi
        .spyOn(aiModelService, 'deleteAiModel')
        .mockResolvedValue(undefined as any);

      await act(async () => {
        await result.current.removeAiModel('model-1', 'test-provider');
      });

      expect(serviceSpy).toHaveBeenCalledWith({ id: 'model-1', providerId: 'test-provider' });
      expect(refreshSpy).toHaveBeenCalled();
    });
  });

  describe('toggleModelEnabled', () => {
    it('should toggle model enabled state with loading indicators', async () => {
      const { result } = renderHook(() => useStore());
      const toggleLoadingSpy = vi
        .spyOn(result.current, 'internal_toggleAiModelLoading')
        .mockImplementation(() => {});
      const refreshSpy = vi
        .spyOn(result.current, 'refreshAiModelList')
        .mockResolvedValue(undefined);
      const serviceSpy = vi
        .spyOn(aiModelService, 'toggleModelEnabled')
        .mockResolvedValue(undefined as any);

      await act(async () => {
        await result.current.toggleModelEnabled({ enabled: true, id: 'model-1' });
      });

      expect(toggleLoadingSpy).toHaveBeenCalledWith('model-1', true);
      expect(serviceSpy).toHaveBeenCalledWith({
        enabled: true,
        id: 'model-1',
        providerId: 'test-provider',
      });
      expect(refreshSpy).toHaveBeenCalled();
      expect(toggleLoadingSpy).toHaveBeenCalledWith('model-1', false);
    });

    it('should not toggle when no active provider', async () => {
      act(() => {
        useStore.setState({ activeAiProvider: undefined });
      });

      const { result } = renderHook(() => useStore());
      const serviceSpy = vi
        .spyOn(aiModelService, 'toggleModelEnabled')
        .mockResolvedValue(undefined as any);

      await act(async () => {
        await result.current.toggleModelEnabled({ enabled: true, id: 'model-1' });
      });

      expect(serviceSpy).not.toHaveBeenCalled();
    });

    it('should handle service errors and throw without clearing loading state', async () => {
      const { result } = renderHook(() => useStore());
      const toggleLoadingSpy = vi
        .spyOn(result.current, 'internal_toggleAiModelLoading')
        .mockImplementation(() => {});
      vi.spyOn(result.current, 'refreshAiModelList').mockResolvedValue(undefined);
      vi.spyOn(aiModelService, 'toggleModelEnabled').mockRejectedValue(new Error('Service error'));

      await expect(async () => {
        await act(async () => {
          await result.current.toggleModelEnabled({ enabled: true, id: 'model-1' });
        });
      }).rejects.toThrow('Service error');

      expect(toggleLoadingSpy).toHaveBeenCalledWith('model-1', true);
      // Loading state is not cleared when error occurs since there's no try-finally
      expect(toggleLoadingSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateModelReasoningConfig', () => {
    it('should optimistically merge the value and persist it via the service', async () => {
      act(() => {
        useStore.setState({
          modelReasoningConfigMap: { 'openai/gpt-5.2': { reasoningEffort: 'low' } },
        });
      });

      const { result } = renderHook(() => useStore());
      const serviceSpy = vi
        .spyOn(aiModelService, 'updateAiModelReasoningConfig')
        .mockResolvedValue(undefined as any);

      await act(async () => {
        await result.current.updateModelReasoningConfig('gpt-5.2', 'openai', {
          gpt5_2ReasoningEffort: 'high',
        });
      });

      expect(serviceSpy).toHaveBeenCalledWith('gpt-5.2', 'openai', {
        gpt5_2ReasoningEffort: 'high',
      });
      // merged with the previous value, not replaced
      expect(useStore.getState().modelReasoningConfigMap['openai/gpt-5.2']).toEqual({
        gpt5_2ReasoningEffort: 'high',
        reasoningEffort: 'low',
      });
      expect(useStore.getState().modelReasoningConfigUpdatingKeys).toEqual([]);
      expect(mutate).toHaveBeenCalledWith(['aiModel:reasoningConfig', 'openai', 'gpt-5.2']);
    });

    it('should clear the updating marker before revalidating', async () => {
      const { result } = renderHook(() => useStore());
      vi.spyOn(aiModelService, 'updateAiModelReasoningConfig').mockResolvedValue(undefined as any);

      // The fetch hook's onSuccess skips writes while the key is marked
      // updating, so revalidating before the marker clears would discard the
      // server-merged config (sibling fields preserved by the partial write)
      const updatingKeysAtMutate: string[][] = [];
      vi.mocked(mutate).mockImplementationOnce(async () => {
        updatingKeysAtMutate.push([...useStore.getState().modelReasoningConfigUpdatingKeys]);
        return undefined as any;
      });

      await act(async () => {
        await result.current.updateModelReasoningConfig('gpt-5.2', 'openai', {
          gpt5_2ReasoningEffort: 'high',
        });
      });

      expect(updatingKeysAtMutate).toEqual([[]]);
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
            gpt5_2ReasoningEffort: 'high',
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
            gpt5_2ReasoningEffort: 'high',
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
      vi.spyOn(aiModelSelectors, 'isModelHasReasoningExtendParams').mockReturnValue(() => true);
      // Make the runtime-state warm-up a no-op so tests exercise the fetch logic
      act(() => {
        useStore.setState({ isInitAiProviderRuntimeState: true });
      });
    });

    it('should skip the fetch for models without reasoning extend params', async () => {
      vi.spyOn(aiModelSelectors, 'isModelHasReasoningExtendParams').mockReturnValue(() => false);

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

  describe('updateAiModelsConfig', () => {
    it('should update model config and refresh list', async () => {
      const updateData = {
        displayName: 'Updated Model',
        enabled: true,
      };

      const { result } = renderHook(() => useStore());
      const refreshSpy = vi
        .spyOn(result.current, 'refreshAiModelList')
        .mockResolvedValue(undefined);
      const serviceSpy = vi
        .spyOn(aiModelService, 'updateAiModel')
        .mockResolvedValue(undefined as any);

      await act(async () => {
        await result.current.updateAiModelsConfig('model-1', 'test-provider', updateData);
      });

      expect(serviceSpy).toHaveBeenCalledWith('model-1', 'test-provider', updateData);
      expect(refreshSpy).toHaveBeenCalled();
    });
  });

  describe('updateAiModelsSort', () => {
    it('should update model sort order and refresh list', async () => {
      const sortMap = [
        { id: 'model-1', sort: 1 },
        { id: 'model-2', sort: 2 },
      ];

      const { result } = renderHook(() => useStore());
      const refreshSpy = vi
        .spyOn(result.current, 'refreshAiModelList')
        .mockResolvedValue(undefined);
      const serviceSpy = vi
        .spyOn(aiModelService, 'updateAiModelOrder')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.updateAiModelsSort('test-provider', sortMap);
      });

      expect(serviceSpy).toHaveBeenCalledWith('test-provider', sortMap);
      expect(refreshSpy).toHaveBeenCalled();
    });
  });

  describe('useFetchAiModelReasoningConfig', () => {
    it('should fetch the reasoning config and write it to the store map', async () => {
      vi.spyOn(aiModelService, 'getAiModelReasoningConfig').mockResolvedValue({
        gpt5_2ReasoningEffort: 'high',
      });

      const { result } = renderHook(
        () => useStore.getState().useFetchAiModelReasoningConfig('gpt-5.2', 'openai'),
        { wrapper: withSWR },
      );

      await waitFor(() => {
        expect(result.current.data).toEqual({ gpt5_2ReasoningEffort: 'high' });
      });

      expect(aiModelService.getAiModelReasoningConfig).toHaveBeenCalledWith('gpt-5.2', 'openai');
      expect(useStore.getState().modelReasoningConfigMap['openai/gpt-5.2']).toEqual({
        gpt5_2ReasoningEffort: 'high',
      });
    });

    it('should not fetch when model or provider is missing', () => {
      const serviceSpy = vi.spyOn(aiModelService, 'getAiModelReasoningConfig');

      renderHook(() => useStore.getState().useFetchAiModelReasoningConfig(undefined, 'openai'), {
        wrapper: withSWR,
      });

      expect(serviceSpy).not.toHaveBeenCalled();
    });

    it('should not clobber an in-flight optimistic value', async () => {
      act(() => {
        useStore.setState({
          modelReasoningConfigMap: { 'openai/gpt-5.2': { gpt5_2ReasoningEffort: 'high' } },
          modelReasoningConfigUpdatingKeys: ['openai/gpt-5.2'],
        });
      });

      vi.spyOn(aiModelService, 'getAiModelReasoningConfig').mockResolvedValue({
        gpt5_2ReasoningEffort: 'low',
      });

      renderHook(() => useStore.getState().useFetchAiModelReasoningConfig('gpt-5.2', 'openai'), {
        wrapper: withSWR,
      });

      await waitFor(() => {
        expect(aiModelService.getAiModelReasoningConfig).toHaveBeenCalled();
      });

      expect(useStore.getState().modelReasoningConfigMap['openai/gpt-5.2']).toEqual({
        gpt5_2ReasoningEffort: 'high',
      });
    });
  });

  describe('useFetchAiProviderModels', () => {
    it('should fetch provider models and update state', async () => {
      const mockModels: AiProviderModelListItem[] = [
        {
          abilities: {},
          displayName: 'Model 1',
          enabled: true,
          id: 'model-1',
          source: 'builtin',
          type: 'chat',
        } as AiProviderModelListItem,
      ];

      vi.spyOn(aiModelService, 'getAiProviderModelList').mockResolvedValue(mockModels);

      const { result } = renderHook(
        () => useStore.getState().useFetchAiProviderModels('test-provider'),
        { wrapper: withSWR },
      );

      await waitFor(() => {
        expect(result.current.data).toEqual(mockModels);
      });

      expect(aiModelService.getAiProviderModelList).toHaveBeenCalledWith('test-provider');
    });

    it('should update store state on successful fetch', async () => {
      const mockModels: AiProviderModelListItem[] = [
        {
          abilities: {},
          displayName: 'Model 1',
          enabled: true,
          id: 'model-1',
          source: 'builtin',
          type: 'chat',
        } as AiProviderModelListItem,
      ];

      vi.spyOn(aiModelService, 'getAiProviderModelList').mockResolvedValue(mockModels);

      renderHook(() => useStore.getState().useFetchAiProviderModels('test-provider'), {
        wrapper: withSWR,
      });

      await waitFor(() => {
        const state = useStore.getState();
        expect(state.aiProviderModelList).toEqual(mockModels);
        expect(state.isAiModelListInit).toBe(true);
      });
    });

    it('should not update state if data is same and list is already initialized', async () => {
      const mockModels: AiProviderModelListItem[] = [
        {
          abilities: {},
          displayName: 'Model 1',
          enabled: true,
          id: 'model-1',
          source: 'builtin',
          type: 'chat',
        } as AiProviderModelListItem,
      ];

      act(() => {
        useStore.setState({
          aiProviderModelList: mockModels,
          isAiModelListInit: true,
        });
      });

      vi.spyOn(aiModelService, 'getAiProviderModelList').mockResolvedValue(mockModels);

      const setStateSpy = vi.spyOn(useStore, 'setState');

      renderHook(() => useStore.getState().useFetchAiProviderModels('test-provider'), {
        wrapper: withSWR,
      });

      await waitFor(() => {
        expect(aiModelService.getAiProviderModelList).toHaveBeenCalled();
      });

      // State should not be updated if data is the same
      expect(setStateSpy).not.toHaveBeenCalled();
    });

    it('should update state if data is different even when initialized', async () => {
      const initialModels: AiProviderModelListItem[] = [
        {
          abilities: {},
          displayName: 'Model 1',
          enabled: true,
          id: 'model-1',
          source: 'builtin',
          type: 'chat',
        } as AiProviderModelListItem,
      ];

      const newModels: AiProviderModelListItem[] = [
        {
          abilities: {},
          displayName: 'Model 2',
          enabled: false,
          id: 'model-2',
          source: 'builtin',
          type: 'chat',
        } as AiProviderModelListItem,
      ];

      act(() => {
        useStore.setState({
          aiProviderModelList: initialModels,
          isAiModelListInit: true,
        });
      });

      vi.spyOn(aiModelService, 'getAiProviderModelList').mockResolvedValue(newModels);

      renderHook(() => useStore.getState().useFetchAiProviderModels('test-provider'), {
        wrapper: withSWR,
      });

      await waitFor(() => {
        const state = useStore.getState();
        expect(state.aiProviderModelList).toEqual(newModels);
      });
    });
  });
});
