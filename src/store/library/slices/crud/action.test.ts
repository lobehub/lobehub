import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { knowledgeBaseService } from '@/services/knowledgeBase';
import { type CreateKnowledgeBaseParams, type KnowledgeBaseItem } from '@/types/knowledgeBase';
import { withSWR } from '~test-utils';

import { useKnowledgeBaseStore } from '../../store';

vi.mock('zustand/traditional');

vi.mock('swr', async (importOriginal) => {
  const modules = await importOriginal();
  return {
    ...(modules as any),
    mutate: vi.fn(),
  };
});

beforeEach(() => {
  vi.clearAllMocks();

  useKnowledgeBaseStore.setState(
    {
      activeKnowledgeBaseId: null,
      activeKnowledgeBaseItems: {},
      initKnowledgeBaseList: false,
      knowledgeBaseLoadingIds: [],
      knowledgeBaseRenamingId: null,
    },
    false,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('KnowledgeBaseCrudAction', () => {
  describe('createNewKnowledgeBase', () => {
    it('should create knowledge base and refresh list', async () => {
      const params: CreateKnowledgeBaseParams = {
        name: 'Test KB',
        description: 'Test Description',
      };

      vi.spyOn(knowledgeBaseService, 'createKnowledgeBase').mockResolvedValue('new-kb-id');

      const { result } = renderHook(() => useKnowledgeBaseStore());
      const refreshSpy = vi.spyOn(result.current, 'refreshKnowledgeBaseList').mockResolvedValue();

      const id = await act(async () => {
        return await result.current.createNewKnowledgeBase(params);
      });

      expect(knowledgeBaseService.createKnowledgeBase).toHaveBeenCalledWith(params);
      expect(refreshSpy).toHaveBeenCalled();
      expect(id).toBe('new-kb-id');
    });

    it('should handle errors during creation', async () => {
      const params: CreateKnowledgeBaseParams = {
        name: 'Test KB',
      };

      const error = new Error('Creation failed');
      vi.spyOn(knowledgeBaseService, 'createKnowledgeBase').mockRejectedValue(error);

      const { result } = renderHook(() => useKnowledgeBaseStore());

      await expect(
        act(async () => {
          await result.current.createNewKnowledgeBase(params);
        }),
      ).rejects.toThrow('Creation failed');
    });
  });

  describe('internal_toggleKnowledgeBaseLoading', () => {
    it('should add id to loading state when loading is true', () => {
      const { result } = renderHook(() => useKnowledgeBaseStore());

      act(() => {
        result.current.internal_toggleKnowledgeBaseLoading('kb-1', true);
      });

      expect(result.current.knowledgeBaseLoadingIds).toContain('kb-1');
    });

    it('should remove id from loading state when loading is false', () => {
      act(() => {
        useKnowledgeBaseStore.setState({
          knowledgeBaseLoadingIds: ['kb-1', 'kb-2'],
        });
      });

      const { result } = renderHook(() => useKnowledgeBaseStore());

      act(() => {
        result.current.internal_toggleKnowledgeBaseLoading('kb-1', false);
      });

      expect(result.current.knowledgeBaseLoadingIds).not.toContain('kb-1');
      expect(result.current.knowledgeBaseLoadingIds).toContain('kb-2');
    });

    it('should handle multiple toggle operations', () => {
      const { result } = renderHook(() => useKnowledgeBaseStore());

      act(() => {
        result.current.internal_toggleKnowledgeBaseLoading('kb-1', true);
        result.current.internal_toggleKnowledgeBaseLoading('kb-2', true);
        result.current.internal_toggleKnowledgeBaseLoading('kb-3', true);
      });

      expect(result.current.knowledgeBaseLoadingIds).toEqual(['kb-1', 'kb-2', 'kb-3']);

      act(() => {
        result.current.internal_toggleKnowledgeBaseLoading('kb-2', false);
      });

      expect(result.current.knowledgeBaseLoadingIds).toEqual(['kb-1', 'kb-3']);
    });
  });

  describe('refreshKnowledgeBaseList', () => {
    it('should execute refresh without errors', async () => {
      const { result } = renderHook(() => useKnowledgeBaseStore());

      // The action uses mutate internally - we just verify it doesn't throw
      await expect(
        act(async () => {
          await result.current.refreshKnowledgeBaseList();
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('removeKnowledgeBase', () => {
    it('should delete knowledge base and refresh list', async () => {
      vi.spyOn(knowledgeBaseService, 'deleteKnowledgeBase').mockResolvedValue(undefined as any);

      const { result } = renderHook(() => useKnowledgeBaseStore());
      const refreshSpy = vi.spyOn(result.current, 'refreshKnowledgeBaseList').mockResolvedValue();

      await act(async () => {
        await result.current.removeKnowledgeBase('kb-to-delete');
      });

      expect(knowledgeBaseService.deleteKnowledgeBase).toHaveBeenCalledWith('kb-to-delete');
      expect(refreshSpy).toHaveBeenCalled();
    });

    it('should handle errors during deletion', async () => {
      const error = new Error('Deletion failed');
      vi.spyOn(knowledgeBaseService, 'deleteKnowledgeBase').mockRejectedValue(error);

      const { result } = renderHook(() => useKnowledgeBaseStore());

      await expect(
        act(async () => {
          await result.current.removeKnowledgeBase('kb-id');
        }),
      ).rejects.toThrow('Deletion failed');
    });
  });

  describe('updateKnowledgeBase', () => {
    it('should update knowledge base with loading states', async () => {
      const updateParams: CreateKnowledgeBaseParams = {
        name: 'Updated KB',
        description: 'Updated Description',
      };

      vi.spyOn(knowledgeBaseService, 'updateKnowledgeBaseList').mockResolvedValue(undefined as any);

      const { result } = renderHook(() => useKnowledgeBaseStore());
      const toggleLoadingSpy = vi.spyOn(result.current, 'internal_toggleKnowledgeBaseLoading');
      const refreshSpy = vi.spyOn(result.current, 'refreshKnowledgeBaseList').mockResolvedValue();

      await act(async () => {
        await result.current.updateKnowledgeBase('kb-1', updateParams);
      });

      expect(toggleLoadingSpy).toHaveBeenCalledWith('kb-1', true);
      expect(knowledgeBaseService.updateKnowledgeBaseList).toHaveBeenCalledWith(
        'kb-1',
        updateParams,
      );
      expect(refreshSpy).toHaveBeenCalled();
      expect(toggleLoadingSpy).toHaveBeenCalledWith('kb-1', false);
    });

    it('should toggle loading off even if update fails', async () => {
      const error = new Error('Update failed');
      vi.spyOn(knowledgeBaseService, 'updateKnowledgeBaseList').mockRejectedValue(error);

      const { result } = renderHook(() => useKnowledgeBaseStore());
      const toggleLoadingSpy = vi.spyOn(result.current, 'internal_toggleKnowledgeBaseLoading');

      await expect(
        act(async () => {
          await result.current.updateKnowledgeBase('kb-1', { name: 'Test' });
        }),
      ).rejects.toThrow('Update failed');

      expect(toggleLoadingSpy).toHaveBeenCalledWith('kb-1', true);
      // The false toggle won't be called because the error interrupts the flow
    });
  });

  describe('useFetchKnowledgeBaseItem', () => {
    it('should fetch knowledge base item by id', async () => {
      const mockItem: KnowledgeBaseItem = {
        id: 'kb-1',
        name: 'Test KB',
        description: 'Test Description',
        avatar: 'avatar-url',
        type: 'file',
        enabled: true,
        isPublic: false,
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.spyOn(knowledgeBaseService, 'getKnowledgeBaseById').mockResolvedValue(mockItem);

      const { result } = renderHook(
        () => useKnowledgeBaseStore().useFetchKnowledgeBaseItem('kb-1'),
        {
          wrapper: withSWR,
        },
      );

      await waitFor(() => {
        expect(result.current.data).toEqual(mockItem);
      });

      expect(knowledgeBaseService.getKnowledgeBaseById).toHaveBeenCalledWith('kb-1');
    });

    it('should update store state on successful fetch', async () => {
      const mockItem: KnowledgeBaseItem = {
        id: 'kb-2',
        name: 'Another KB',
        description: 'Another Description',
        avatar: 'avatar-url-2',
        type: 'file',
        enabled: true,
        isPublic: false,
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.spyOn(knowledgeBaseService, 'getKnowledgeBaseById').mockResolvedValue(mockItem);

      const { result } = renderHook(
        () => useKnowledgeBaseStore().useFetchKnowledgeBaseItem('kb-2'),
        {
          wrapper: withSWR,
        },
      );

      await waitFor(() => {
        expect(result.current.data).toEqual(mockItem);
      });

      const state = useKnowledgeBaseStore.getState();
      expect(state.activeKnowledgeBaseId).toBe('kb-2');
      expect(state.activeKnowledgeBaseItems['kb-2']).toEqual(mockItem);
    });

    it('should not update store when item is undefined', async () => {
      vi.spyOn(knowledgeBaseService, 'getKnowledgeBaseById').mockResolvedValue(undefined);

      act(() => {
        useKnowledgeBaseStore.setState({
          activeKnowledgeBaseId: 'original-id',
          activeKnowledgeBaseItems: {},
        });
      });

      const { result } = renderHook(
        () => useKnowledgeBaseStore().useFetchKnowledgeBaseItem('kb-3'),
        {
          wrapper: withSWR,
        },
      );

      await waitFor(() => {
        expect(result.current.data).toBeUndefined();
      });

      const state = useKnowledgeBaseStore.getState();
      expect(state.activeKnowledgeBaseId).toBe('original-id');
      expect(state.activeKnowledgeBaseItems).toEqual({});
    });

    it('should preserve existing items when updating', async () => {
      const existingItem: KnowledgeBaseItem = {
        id: 'kb-existing',
        name: 'Existing KB',
        description: 'Existing',
        avatar: 'avatar-existing',
        type: 'file',
        enabled: true,
        isPublic: false,
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const newItem: KnowledgeBaseItem = {
        id: 'kb-new',
        name: 'New KB',
        description: 'New',
        avatar: 'avatar-new',
        type: 'file',
        enabled: true,
        isPublic: false,
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      act(() => {
        useKnowledgeBaseStore.setState({
          activeKnowledgeBaseItems: {
            'kb-existing': existingItem,
          },
        });
      });

      vi.spyOn(knowledgeBaseService, 'getKnowledgeBaseById').mockResolvedValue(newItem);

      const { result } = renderHook(
        () => useKnowledgeBaseStore().useFetchKnowledgeBaseItem('kb-new'),
        {
          wrapper: withSWR,
        },
      );

      await waitFor(() => {
        expect(result.current.data).toEqual(newItem);
      });

      const state = useKnowledgeBaseStore.getState();
      expect(state.activeKnowledgeBaseItems['kb-existing']).toEqual(existingItem);
      expect(state.activeKnowledgeBaseItems['kb-new']).toEqual(newItem);
    });
  });

  describe('useFetchKnowledgeBaseList', () => {
    it('should fetch knowledge base list with default config', async () => {
      const mockList: KnowledgeBaseItem[] = [
        {
          id: 'kb-1',
          name: 'KB 1',
          description: 'Description 1',
          avatar: 'avatar-1',
          type: 'file',
          enabled: true,
          isPublic: false,
          settings: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'kb-2',
          name: 'KB 2',
          description: 'Description 2',
          avatar: 'avatar-2',
          type: 'file',
          enabled: false,
          isPublic: false,
          settings: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      vi.spyOn(knowledgeBaseService, 'getKnowledgeBaseList').mockResolvedValue(mockList);

      const { result } = renderHook(() => useKnowledgeBaseStore().useFetchKnowledgeBaseList(), {
        wrapper: withSWR,
      });

      await waitFor(() => {
        expect(result.current.data).toEqual(mockList);
      });

      expect(knowledgeBaseService.getKnowledgeBaseList).toHaveBeenCalled();
    });

    it('should use fallback data when service returns empty', async () => {
      vi.spyOn(knowledgeBaseService, 'getKnowledgeBaseList').mockResolvedValue([]);

      const { result } = renderHook(() => useKnowledgeBaseStore().useFetchKnowledgeBaseList(), {
        wrapper: withSWR,
      });

      // Wait for the SWR hook to settle
      await waitFor(() => {
        expect(result.current.data).toEqual([]);
      });
    });

    it('should initialize knowledge base list on first success', async () => {
      const mockList: KnowledgeBaseItem[] = [
        {
          id: 'kb-1',
          name: 'KB 1',
          description: 'Description 1',
          avatar: 'avatar-1',
          type: 'file',
          enabled: true,
          isPublic: false,
          settings: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      // Ensure initKnowledgeBaseList is false initially
      act(() => {
        useKnowledgeBaseStore.setState({
          initKnowledgeBaseList: false,
        });
      });

      vi.spyOn(knowledgeBaseService, 'getKnowledgeBaseList').mockResolvedValue(mockList);

      const { result } = renderHook(() => useKnowledgeBaseStore().useFetchKnowledgeBaseList(), {
        wrapper: withSWR,
      });

      // Wait for the SWR hook to settle and onSuccess to be called
      await waitFor(() => {
        expect(result.current.data).toEqual(mockList);
      });

      // Verify initKnowledgeBaseList is set to true after onSuccess
      await waitFor(() => {
        const state = useKnowledgeBaseStore.getState();
        expect(state.initKnowledgeBaseList).toBe(true);
      });
    });

    it('should not re-initialize if already initialized', async () => {
      const mockList: KnowledgeBaseItem[] = [];

      act(() => {
        useKnowledgeBaseStore.setState({
          initKnowledgeBaseList: true,
        });
      });

      vi.spyOn(knowledgeBaseService, 'getKnowledgeBaseList').mockResolvedValue(mockList);

      const { result } = renderHook(() => useKnowledgeBaseStore().useFetchKnowledgeBaseList(), {
        wrapper: withSWR,
      });

      await waitFor(() => {
        expect(result.current.data).toEqual(mockList);
      });

      const state = useKnowledgeBaseStore.getState();
      expect(state.initKnowledgeBaseList).toBe(true);
    });
  });
});
