import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createReplicaState } from '@/libs/replica';
import type * as SwrModule from '@/libs/swr';
import { mutate } from '@/libs/swr';
import { generationService } from '@/services/generation';
import { generationBatchService } from '@/services/generationBatch';
import { useImageStore } from '@/store/image';
import { generationBatchSelectors } from '@/store/image/slices/generationBatch/selectors';
import { AsyncTaskStatus } from '@/types/asyncTask';
import { type GenerationBatch } from '@/types/generation';

// The replica driver revalidates through the scoped `mutate`; mock it so the
// imperative refresh assertions below can observe the call.
vi.mock('@/libs/swr', async (importOriginal) => {
  const actual = await importOriginal<typeof SwrModule>();
  return { ...actual, mutate: vi.fn() };
});

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

const batch = (id: string, generationIds: string[]): GenerationBatch =>
  ({
    id,
    provider: 'openai',
    model: 'dall-e-3',
    prompt: 'Test prompt',
    createdAt: new Date(),
    generations: generationIds.map((generationId) => ({
      id: generationId,
      seed: 12345,
      createdAt: new Date(),
      asyncTaskId: null,
      task: { id: `task_${generationId}`, status: AsyncTaskStatus.Success },
    })),
  }) as unknown as GenerationBatch;

/** Seed one loaded topic into the batch replica view. */
const seedBatch = (topicId: string, batches: GenerationBatch[]) => {
  useImageStore.setState({
    activeGenerationTopicId: topicId,
    generationBatchesMap: { [topicId]: batches },
    generationBatchesReplica: createReplicaState(),
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  useImageStore.setState({
    activeGenerationTopicId: null,
    generationBatchesMap: {},
    generationBatchesReplica: createReplicaState(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GenerationBatchAction', () => {
  describe('setTopicBatchLoaded', () => {
    it('seeds an empty list and marks the topic as loaded', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';

      act(() => {
        useImageStore.setState({ activeGenerationTopicId: topicId });
      });

      expect(generationBatchSelectors.isCurrentGenerationTopicLoaded(result.current)).toBe(false);

      act(() => {
        result.current.setTopicBatchLoaded(topicId);
      });

      expect(result.current.generationBatchesMap[topicId]).toEqual([]);
      expect(generationBatchSelectors.isCurrentGenerationTopicLoaded(result.current)).toBe(true);
    });

    it('keeps the existing list reference when the topic is already loaded', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';

      act(() => {
        seedBatch(topicId, []);
      });

      const stateBefore = result.current.generationBatchesMap;

      act(() => {
        result.current.setTopicBatchLoaded(topicId);
      });

      expect(result.current.generationBatchesMap).toBe(stateBefore);
    });
  });

  describe('removeGeneration', () => {
    it('should remove generation and clean up empty batch', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';

      act(() => {
        seedBatch(topicId, [batch('gb_batch_1', ['gen_1'])]);
      });

      const deleteBatchSpy = vi
        .spyOn(result.current, 'internal_deleteGenerationBatch')
        .mockResolvedValue(undefined);
      const refreshSpy = vi.spyOn(result.current, 'refreshGenerationBatches');

      await act(async () => {
        await result.current.removeGeneration('gen_1');
      });

      expect(generationService.deleteGeneration).toHaveBeenCalledWith('gen_1');
      expect(deleteBatchSpy).toHaveBeenCalledWith('gb_batch_1', topicId);
      expect(refreshSpy).toHaveBeenCalled();
    });

    it('should only remove generation if batch is not empty', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';

      act(() => {
        seedBatch(topicId, [batch('gb_batch_1', ['gen_1', 'gen_2'])]);
      });

      const deleteBatchSpy = vi.spyOn(result.current, 'internal_deleteGenerationBatch');

      await act(async () => {
        await result.current.removeGeneration('gen_1');
      });

      expect(deleteBatchSpy).not.toHaveBeenCalled();
    });

    it('should do nothing if no active topic', async () => {
      const { result } = renderHook(() => useImageStore());

      await act(async () => {
        await result.current.removeGeneration('gen_1');
      });

      expect(generationService.deleteGeneration).not.toHaveBeenCalled();
    });
  });

  describe('internal_deleteGeneration', () => {
    it('should delete the generation optimistically and confirm with the server', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';

      act(() => {
        seedBatch(topicId, [batch('gb_batch_1', ['gen_1', 'gen_2'])]);
      });

      await act(async () => {
        await result.current.internal_deleteGeneration('gen_1');
      });

      expect(generationService.deleteGeneration).toHaveBeenCalledWith('gen_1');
      const generations = result.current.generationBatchesMap[topicId][0].generations;
      expect(generations.map((generation) => generation.id)).toEqual(['gen_2']);
    });

    it('should do nothing if generation not found', async () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        seedBatch('gt_topic_1', []);
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

      const deleteBatchSpy = vi
        .spyOn(result.current, 'internal_deleteGenerationBatch')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.removeGenerationBatch('gb_batch_1', 'gt_topic_1');
      });

      expect(deleteBatchSpy).toHaveBeenCalledWith('gb_batch_1', 'gt_topic_1');
    });
  });

  describe('internal_deleteGenerationBatch', () => {
    it('should delete the batch optimistically and confirm with the server', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';

      act(() => {
        seedBatch(topicId, [batch('gb_batch_1', ['gen_1'])]);
      });

      await act(async () => {
        await result.current.internal_deleteGenerationBatch('gb_batch_1', topicId);
      });

      expect(generationBatchService.deleteGenerationBatch).toHaveBeenCalledWith('gb_batch_1');
      expect(result.current.generationBatchesMap[topicId]).toEqual([]);
    });
  });

  describe('internal_dispatchGenerationBatch', () => {
    it('should update a loaded topic when state changes', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';

      act(() => {
        seedBatch(topicId, []);
      });

      act(() => {
        result.current.internal_dispatchGenerationBatch(topicId, {
          type: 'addBatch',
          value: batch('gb_batch_1', []),
        });
      });

      expect(result.current.generationBatchesMap[topicId]).toHaveLength(1);
      expect(result.current.generationBatchesMap[topicId][0].id).toBe('gb_batch_1');
    });

    it('should leave an unloaded topic untouched', async () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        result.current.internal_dispatchGenerationBatch('gt_not_loaded', {
          type: 'addBatch',
          value: batch('gb_batch_1', []),
        });
      });

      expect(result.current.generationBatchesMap['gt_not_loaded']).toBeUndefined();
    });
  });

  describe('refreshGenerationBatches', () => {
    it('should revalidate the active topic entry', async () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        useImageStore.setState({ activeGenerationTopicId: 'gt_topic_1' });
      });

      await act(async () => {
        await result.current.refreshGenerationBatches();
      });

      expect(mutate).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should not revalidate when no active topic', async () => {
      const { result } = renderHook(() => useImageStore());

      await act(async () => {
        await result.current.refreshGenerationBatches();
      });

      expect(mutate).not.toHaveBeenCalled();
    });
  });

  describe('useFetchGenerationBatches', () => {
    it('should not fetch when no topicId', async () => {
      const { result } = renderHook(() => useImageStore().useFetchGenerationBatches(null));

      expect(result.current.data).toBeUndefined();
      expect(generationBatchService.getGenerationBatches).not.toHaveBeenCalled();
    });
  });

  describe('useCheckGenerationStatus', () => {
    it('should not check status for temporary generations', async () => {
      const { result } = renderHook(() =>
        useImageStore().useCheckGenerationStatus('temp-gen-1', 'task_1', 'gt_topic_1'),
      );

      expect(result.current.data).toBeUndefined();
      expect(generationService.getGenerationStatus).not.toHaveBeenCalled();
    });

    it('should not check status when disabled', async () => {
      const { result } = renderHook(() =>
        useImageStore().useCheckGenerationStatus('gen_1', 'task_1', 'gt_topic_1', false),
      );

      expect(result.current.data).toBeUndefined();
      expect(generationService.getGenerationStatus).not.toHaveBeenCalled();
    });
  });
});
