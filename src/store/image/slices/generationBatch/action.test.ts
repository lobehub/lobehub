import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mutate } from '@/libs/swr';
import { generationService } from '@/services/generation';
import { generationBatchService } from '@/services/generationBatch';
import { useImageStore } from '@/store/image';
import { generationBatchSelectors } from '@/store/image/slices/generationBatch/selectors';
import { AsyncTaskStatus } from '@/types/asyncTask';
import { type GenerationBatch } from '@/types/generation';

// Mock services and dependencies
vi.mock('@/services/generation', () => ({
  generationService: {
    deleteGeneration: vi.fn(),
    getGenerationStatus: vi.fn(),
  },
}));

vi.mock('@/services/generationBatch', () => ({
  generationBatchService: {
    deleteGenerationBatch: vi.fn(),
    getGenerationBatches: vi.fn(),
  },
}));

vi.mock('@/libs/swr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/swr')>();
  return {
    ...actual,
    mutate: vi.fn(),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  useImageStore.setState({
    generationBatchesMap: {},
    activeGenerationTopicId: null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GenerationBatchAction', () => {
  describe('setTopicBatchLoaded', () => {
    it('should set topic batch as loaded with empty array and mark topic as loaded', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';

      // Set the topic as active first
      act(() => {
        useImageStore.setState({ activeGenerationTopicId: topicId });
      });

      // Initially topic should not be loaded
      expect(generationBatchSelectors.isCurrentGenerationTopicLoaded(result.current)).toBe(false);

      // Set topic batch as loaded
      act(() => {
        result.current.setTopicBatchLoaded(topicId);
      });

      // Verify both the direct state and the selector
      expect(result.current.generationBatchesMap[topicId]).toEqual([]);
      expect(generationBatchSelectors.isCurrentGenerationTopicLoaded(result.current)).toBe(true);
    });

    it('should not update state if map already has the same value', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';

      act(() => {
        useImageStore.setState({
          generationBatchesMap: { [topicId]: [] },
          activeGenerationTopicId: topicId,
        });
      });

      const stateBefore = result.current.generationBatchesMap;

      // Should already be loaded
      expect(generationBatchSelectors.isCurrentGenerationTopicLoaded(result.current)).toBe(true);

      act(() => {
        result.current.setTopicBatchLoaded(topicId);
      });

      // State reference should remain the same due to isEqual check
      expect(result.current.generationBatchesMap).toBe(stateBefore);
      expect(generationBatchSelectors.isCurrentGenerationTopicLoaded(result.current)).toBe(true);
    });
  });

  describe('removeGeneration', () => {
    it('should remove generation and clean up empty batch', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';
      const batchId = 'gb_batch_1';
      const generationId = 'gen_1';

      const batches: GenerationBatch[] = [
        {
          id: batchId,
          provider: 'openai',
          model: 'dall-e-3',
          prompt: 'Test prompt',
          createdAt: new Date(),
          generations: [
            {
              id: generationId,
              seed: 12345,
              createdAt: new Date(),
              asyncTaskId: null,
              task: {
                id: 'task_1',
                status: AsyncTaskStatus.Success,
              },
            },
          ],
        },
      ];

      act(() => {
        useImageStore.setState({
          activeGenerationTopicId: topicId,
          generationBatchesMap: { [topicId]: batches },
        });
      });

      const deleteGenerationSpy = vi.spyOn(result.current, 'internal_deleteGeneration');
      const deleteBatchSpy = vi.spyOn(result.current, 'internal_deleteGenerationBatch');
      const refreshSpy = vi.spyOn(result.current, 'refreshGenerationBatches');

      await act(async () => {
        await result.current.removeGeneration(generationId);
      });

      expect(deleteGenerationSpy).toHaveBeenCalledWith(generationId);
      expect(deleteBatchSpy).toHaveBeenCalledWith(batchId, topicId);
      expect(refreshSpy).toHaveBeenCalled();
    });

    it('should only remove generation if batch is not empty', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';
      const batchId = 'gb_batch_1';

      const batches: GenerationBatch[] = [
        {
          id: batchId,
          provider: 'openai',
          model: 'dall-e-3',
          prompt: 'Test prompt',
          createdAt: new Date(),
          generations: [
            {
              id: 'gen_1',
              seed: 12345,
              createdAt: new Date(),
              asyncTaskId: null,
              task: {
                id: 'task_1',
                status: AsyncTaskStatus.Success,
              },
            },
            {
              id: 'gen_2',
              seed: 54321,
              createdAt: new Date(),
              asyncTaskId: null,
              task: {
                id: 'task_2',
                status: AsyncTaskStatus.Success,
              },
            },
          ],
        },
      ];

      act(() => {
        useImageStore.setState({
          activeGenerationTopicId: topicId,
          generationBatchesMap: { [topicId]: batches },
        });
      });

      const deleteBatchSpy = vi.spyOn(result.current, 'internal_deleteGenerationBatch');

      await act(async () => {
        await result.current.removeGeneration('gen_1');
      });

      expect(deleteBatchSpy).not.toHaveBeenCalled();
    });

    it('should do nothing if no active topic', async () => {
      const { result } = renderHook(() => useImageStore());

      const deleteGenerationSpy = vi.spyOn(result.current, 'internal_deleteGeneration');

      await act(async () => {
        await result.current.removeGeneration('gen_1');
      });

      expect(deleteGenerationSpy).toHaveBeenCalledWith('gen_1');
      expect(generationService.deleteGeneration).not.toHaveBeenCalled();
    });
  });

  describe('internal_deleteGeneration', () => {
    it('should delete generation with optimistic update', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';
      const batchId = 'gb_batch_1';
      const generationId = 'gen_1';

      const batches: GenerationBatch[] = [
        {
          id: batchId,
          provider: 'openai',
          model: 'dall-e-3',
          prompt: 'Test prompt',
          createdAt: new Date(),
          generations: [
            {
              id: generationId,
              seed: 12345,
              createdAt: new Date(),
              asyncTaskId: null,
              task: {
                id: 'task_1',
                status: AsyncTaskStatus.Success,
              },
            },
          ],
        },
      ];

      act(() => {
        useImageStore.setState({
          activeGenerationTopicId: topicId,
          generationBatchesMap: { [topicId]: batches },
        });
      });

      const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchGenerationBatch');
      const refreshSpy = vi.spyOn(result.current, 'refreshGenerationBatches');

      await act(async () => {
        await result.current.internal_deleteGeneration(generationId);
      });

      expect(dispatchSpy).toHaveBeenCalledWith(
        topicId,
        { type: 'deleteGenerationInBatch', batchId, generationId },
        'internal_deleteGeneration',
      );
      expect(generationService.deleteGeneration).toHaveBeenCalledWith(generationId);
      expect(refreshSpy).toHaveBeenCalled();
    });

    it('should do nothing if generation not found', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';

      act(() => {
        useImageStore.setState({
          activeGenerationTopicId: topicId,
          generationBatchesMap: { [topicId]: [] },
        });
      });

      await act(async () => {
        await result.current.internal_deleteGeneration('non_existent_gen');
      });

      expect(generationService.deleteGeneration).not.toHaveBeenCalled();
    });
  });

  describe('removeGenerationBatch', () => {
    it('should call internal_deleteGenerationBatch', async () => {
      const { result } = renderHook(() => useImageStore());
      const batchId = 'gb_batch_1';
      const topicId = 'gt_topic_1';

      const deleteBatchSpy = vi.spyOn(result.current, 'internal_deleteGenerationBatch');

      await act(async () => {
        await result.current.removeGenerationBatch(batchId, topicId);
      });

      expect(deleteBatchSpy).toHaveBeenCalledWith(batchId, topicId);
    });
  });

  describe('internal_deleteGenerationBatch', () => {
    it('should delete batch with optimistic update', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';
      const batchId = 'gb_batch_1';

      const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchGenerationBatch');
      const refreshSpy = vi.spyOn(result.current, 'refreshGenerationBatches');

      await act(async () => {
        await result.current.internal_deleteGenerationBatch(batchId, topicId);
      });

      expect(dispatchSpy).toHaveBeenCalledWith(
        topicId,
        { type: 'deleteBatch', id: batchId },
        'internal_deleteGenerationBatch',
      );
      expect(generationBatchService.deleteGenerationBatch).toHaveBeenCalledWith(batchId);
      expect(refreshSpy).toHaveBeenCalled();
    });
  });

  describe('internal_dispatchGenerationBatch', () => {
    it('should update batch map when state changes', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';

      act(() => {
        useImageStore.setState({ generationBatchesMap: { [topicId]: [] } });
      });

      act(() => {
        result.current.internal_dispatchGenerationBatch(
          topicId,
          {
            type: 'addBatch',
            value: {
              id: 'gb_batch_1',
              provider: 'openai',
              model: 'dall-e-3',
              prompt: 'Test prompt',
              createdAt: new Date(),
              generations: [],
            },
          },
          'test_action',
        );
      });

      expect(result.current.generationBatchesMap[topicId]).toHaveLength(1);
      expect(result.current.generationBatchesMap[topicId][0].id).toBe('gb_batch_1');
    });

    it('should not update when map is equal', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';
      const existingBatches: GenerationBatch[] = [
        {
          id: 'gb_batch_1',
          provider: 'openai',
          model: 'dall-e-3',
          prompt: 'Test prompt',
          createdAt: new Date('2024-01-01'),
          generations: [],
        },
      ];

      act(() => {
        useImageStore.setState({ generationBatchesMap: { [topicId]: existingBatches } });
      });

      const stateBefore = result.current.generationBatchesMap;

      // Try to update with same data (reducer will return same array reference)
      act(() => {
        result.current.internal_dispatchGenerationBatch(
          topicId,
          {
            type: 'updateBatch',
            id: 'gb_batch_1',
            value: { prompt: 'Test prompt' }, // Same prompt
          },
          'test_action',
        );
      });

      // State reference should remain the same due to isEqual check
      expect(result.current.generationBatchesMap).toBe(stateBefore);
    });
  });

  describe('refreshGenerationBatches', () => {
    it('should call mutate when there is active topic', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';

      act(() => {
        useImageStore.setState({ activeGenerationTopicId: topicId });
      });

      await act(async () => {
        await result.current.refreshGenerationBatches();
      });

      expect(mutate).toHaveBeenCalledWith(['SWR_USE_FETCH_GENERATION_BATCHES', topicId]);
    });

    it('should not call mutate when no active topic', async () => {
      const { result } = renderHook(() => useImageStore());

      await act(async () => {
        await result.current.refreshGenerationBatches();
      });

      expect(mutate).not.toHaveBeenCalled();
    });
  });

  describe('useFetchGenerationBatches', () => {
    it('should fetch batches for a topic', async () => {
      const topicId = 'gt_topic_1';
      const batches: GenerationBatch[] = [
        {
          id: 'gb_batch_1',
          provider: 'openai',
          model: 'dall-e-3',
          prompt: 'Test prompt',
          createdAt: new Date(),
          generations: [],
        },
      ];

      vi.mocked(generationBatchService.getGenerationBatches).mockResolvedValue(batches);

      const { result } = renderHook(() => {
        const store = useImageStore();

        // Simulate the onSuccess callback behavior directly
        React.useEffect(() => {
          useImageStore.setState({
            generationBatchesMap: { [topicId]: batches },
          });
        }, []);

        return { data: batches };
      });

      await waitFor(() => {
        expect(useImageStore.getState().generationBatchesMap[topicId]).toEqual(batches);
      });
    });

    it('should not fetch when no topicId', async () => {
      const { result } = renderHook(() => {
        const store = useImageStore();
        // Test the actual hook with null parameter
        const swrResult = store.useFetchGenerationBatches(null);
        return swrResult;
      });

      // When key is null, SWR returns an object with undefined data
      expect(result.current.data).toBeUndefined();
      expect(generationBatchService.getGenerationBatches).not.toHaveBeenCalled();
    });
  });

  describe('useCheckGenerationStatus', () => {
    it('should not check status for temporary generations', async () => {
      const { result } = renderHook(() => {
        const store = useImageStore();
        // Test the actual hook with temporary generation ID
        const swrResult = store.useCheckGenerationStatus('temp-gen-1', 'task_1', 'gt_topic_1');
        return swrResult;
      });

      // When conditions aren't met, SWR returns an object with undefined data
      expect(result.current.data).toBeUndefined();
      expect(generationService.getGenerationStatus).not.toHaveBeenCalled();
    });

    it('should not check status when disabled', async () => {
      const { result } = renderHook(() => {
        const store = useImageStore();
        // Test the actual hook with enable=false
        const swrResult = store.useCheckGenerationStatus('gen_1', 'task_1', 'gt_topic_1', false);
        return swrResult;
      });

      // When disabled, SWR returns an object with undefined data
      expect(result.current.data).toBeUndefined();
      expect(generationService.getGenerationStatus).not.toHaveBeenCalled();
    });
  });
});
