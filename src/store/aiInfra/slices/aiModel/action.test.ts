import { act, renderHook, waitFor } from '@testing-library/react';
import { type AiProviderModelListItem } from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mutate } from '@/libs/swr';
import { aiModelService } from '@/services/aiModel';
import { withSWR } from '~test-utils';

import { useAiInfraStore as useStore } from '../../store';

vi.mock('zustand/traditional');

vi.mock('@/libs/swr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/swr')>();
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
        .spyOn(result.current, 'batchUpdateAiModels')
        .mockResolvedValue(undefined);
      const refreshSpy = vi
        .spyOn(result.current, 'refreshAiModelList')
        .mockResolvedValue(undefined);

      // Mock dynamic import
      vi.doMock('@/services/models', () => ({
        modelsService: {
          getModels: vi.fn().mockResolvedValue(mockRemoteModels),
        },
      }));

      await act(async () => {
        await result.current.fetchRemoteModelList('test-provider');
      });

      // Wait for the dynamic import and batch update
      await waitFor(() => {
        expect(batchUpdateSpy).toHaveBeenCalled();
      });

      const batchUpdateArg = batchUpdateSpy.mock.calls[0][0];
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

      expect(refreshSpy).toHaveBeenCalled();
    });

    it('should not update if remote service returns no data', async () => {
      const { result } = renderHook(() => useStore());
      const batchUpdateSpy = vi
        .spyOn(result.current, 'batchUpdateAiModels')
        .mockResolvedValue(undefined);

      // Mock dynamic import with null response
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

      expect(mutate).toHaveBeenCalledWith(['FETCH_AI_PROVIDER_MODELS', 'test-provider']);
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
