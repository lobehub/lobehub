import { describe, expect, it } from 'vitest';

import { type ImageStore } from '@/store/image';
import { initialState } from '@/store/image/initialState';
import { AsyncTaskStatus } from '@/types/asyncTask';
import { type Generation, type GenerationBatch } from '@/types/generation';
import { merge } from '@/utils/merge';

import { generationBatchSelectors } from './selectors';

const initialStore = initialState as ImageStore;

// Mock generation data
const mockGenerations: Generation[] = [
  {
    id: 'gen-1',
    seed: 12345,
    createdAt: new Date('2024-01-01'),
    asyncTaskId: null,
    asset: {
      type: 'image',
      url: 'image1.jpg',
      width: 1024,
      height: 1024,
    },
    task: {
      id: 'task-1',
      status: AsyncTaskStatus.Success,
    },
  },
  {
    id: 'gen-2',
    seed: 12346,
    createdAt: new Date('2024-01-01'),
    asyncTaskId: null,
    asset: {
      type: 'image',
      url: 'image2.jpg',
      width: 1024,
      height: 1024,
    },
    task: {
      id: 'task-2',
      status: AsyncTaskStatus.Success,
    },
  },
  {
    id: 'gen-3',
    seed: 12347,
    createdAt: new Date('2024-01-02'),
    asyncTaskId: null,
    asset: {
      type: 'image',
      url: 'image3.jpg',
      width: 1024,
      height: 1024,
    },
    task: {
      id: 'task-3',
      status: AsyncTaskStatus.Success,
    },
  },
];

// Mock data
const mockGenerationBatches: GenerationBatch[] = [
  {
    id: 'batch-1',
    provider: 'dall-e-3',
    model: 'dall-e-3',
    prompt: 'A beautiful sunset',
    width: 1024,
    height: 1024,
    generations: [mockGenerations[0], mockGenerations[1]],
    config: {
      prompt: 'A beautiful sunset',
      width: 1024,
      height: 1024,
      size: '1024x1024',
    },
    createdAt: new Date('2024-01-01'),
  },
  {
    id: 'batch-2',
    provider: 'dall-e-3',
    model: 'dall-e-3',
    prompt: 'A mountain landscape',
    width: 1024,
    height: 1024,
    generations: [mockGenerations[2]],
    config: {
      prompt: 'A mountain landscape',
      width: 1024,
      height: 1024,
      size: '1024x1024',
    },
    createdAt: new Date('2024-01-02'),
  },
  {
    id: 'batch-3',
    provider: 'midjourney',
    model: 'midjourney-v6',
    prompt: 'A futuristic city',
    width: 1024,
    height: 1024,
    generations: [],
    config: {
      prompt: 'A futuristic city',
      width: 1024,
      height: 1024,
      size: '1024x1024',
    },
    createdAt: new Date('2024-01-03'),
  },
];

describe('generationBatchSelectors', () => {
  describe('getGenerationBatchesByTopicId', () => {
    it('should return batches for a specific topic', () => {
      const state = merge(initialStore, {
        generationBatchesMap: {
          'topic-1': [mockGenerationBatches[0], mockGenerationBatches[1]],
          'topic-2': [mockGenerationBatches[2]],
        },
      });

      const batches = generationBatchSelectors.getGenerationBatchesByTopicId('topic-1')(state);
      expect(batches).toHaveLength(2);
      expect(batches[0].id).toBe('batch-1');
      expect(batches[1].id).toBe('batch-2');
    });

    it('should return empty array if topic has no batches', () => {
      const state = merge(initialStore, {
        generationBatchesMap: {
          'topic-1': [mockGenerationBatches[0]],
        },
      });

      const batches = generationBatchSelectors.getGenerationBatchesByTopicId('topic-2')(state);
      expect(batches).toEqual([]);
    });

    it('should return empty array if topic does not exist', () => {
      const state = merge(initialStore, {
        generationBatchesMap: {},
      });

      const batches = generationBatchSelectors.getGenerationBatchesByTopicId('non-existent')(state);
      expect(batches).toEqual([]);
    });
  });

  describe('currentGenerationBatches', () => {
    it('should return batches for the active topic', () => {
      const state = merge(initialStore, {
        activeGenerationTopicId: 'topic-1',
        generationBatchesMap: {
          'topic-1': [mockGenerationBatches[0], mockGenerationBatches[1]],
          'topic-2': [mockGenerationBatches[2]],
        },
      });

      const batches = generationBatchSelectors.currentGenerationBatches(state);
      expect(batches).toHaveLength(2);
      expect(batches).toEqual([mockGenerationBatches[0], mockGenerationBatches[1]]);
    });

    it('should return empty array if no active topic', () => {
      const state = merge(initialStore, {
        activeGenerationTopicId: undefined,
        generationBatchesMap: {
          'topic-1': [mockGenerationBatches[0]],
        },
      });

      const batches = generationBatchSelectors.currentGenerationBatches(state);
      expect(batches).toEqual([]);
    });

    it('should return empty array if active topic has no batches', () => {
      const state = merge(initialStore, {
        activeGenerationTopicId: 'topic-3',
        generationBatchesMap: {
          'topic-1': [mockGenerationBatches[0]],
        },
      });

      const batches = generationBatchSelectors.currentGenerationBatches(state);
      expect(batches).toEqual([]);
    });
  });

  describe('getGenerationBatchByBatchId', () => {
    it('should return the batch with matching id', () => {
      const state = merge(initialStore, {
        activeGenerationTopicId: 'topic-1',
        generationBatchesMap: {
          'topic-1': [mockGenerationBatches[0], mockGenerationBatches[1]],
        },
      });

      const batch = generationBatchSelectors.getGenerationBatchByBatchId('batch-2')(state);
      expect(batch).toEqual(mockGenerationBatches[1]);
    });

    it('should return undefined if batch not found', () => {
      const state = merge(initialStore, {
        activeGenerationTopicId: 'topic-1',
        generationBatchesMap: {
          'topic-1': [mockGenerationBatches[0]],
        },
      });

      const batch = generationBatchSelectors.getGenerationBatchByBatchId('non-existent')(state);
      expect(batch).toBeUndefined();
    });

    it('should return undefined if no active topic', () => {
      const state = merge(initialStore, {
        activeGenerationTopicId: undefined,
        generationBatchesMap: {
          'topic-1': [mockGenerationBatches[0]],
        },
      });

      const batch = generationBatchSelectors.getGenerationBatchByBatchId('batch-1')(state);
      expect(batch).toBeUndefined();
    });

    it('should only search in current topic batches', () => {
      const state = merge(initialStore, {
        activeGenerationTopicId: 'topic-1',
        generationBatchesMap: {
          'topic-1': [mockGenerationBatches[0], mockGenerationBatches[1]],
          'topic-2': [mockGenerationBatches[2]],
        },
      });

      // batch-3 belongs to topic-2, but active topic is topic-1
      const batch = generationBatchSelectors.getGenerationBatchByBatchId('batch-3')(state);
      expect(batch).toBeUndefined();
    });
  });

  describe('isCurrentGenerationTopicLoaded', () => {
    it('should return true if current topic has batches array', () => {
      const state = merge(initialStore, {
        activeGenerationTopicId: 'topic-1',
        generationBatchesMap: {
          'topic-1': [mockGenerationBatches[0]],
        },
      });

      const isLoaded = generationBatchSelectors.isCurrentGenerationTopicLoaded(state);
      expect(isLoaded).toBe(true);
    });

    it('should return true even if batches array is empty', () => {
      const state = merge(initialStore, {
        activeGenerationTopicId: 'topic-1',
        generationBatchesMap: {
          'topic-1': [],
        },
      });

      const isLoaded = generationBatchSelectors.isCurrentGenerationTopicLoaded(state);
      expect(isLoaded).toBe(true);
    });

    it('should return false if current topic has no batches entry', () => {
      const state = merge(initialStore, {
        activeGenerationTopicId: 'topic-2',
        generationBatchesMap: {
          'topic-1': [mockGenerationBatches[0]],
        },
      });

      const isLoaded = generationBatchSelectors.isCurrentGenerationTopicLoaded(state);
      expect(isLoaded).toBe(false);
    });

    it('should return false if no active topic', () => {
      const state = merge(initialStore, {
        activeGenerationTopicId: undefined,
        generationBatchesMap: {
          'topic-1': [mockGenerationBatches[0]],
        },
      });

      const isLoaded = generationBatchSelectors.isCurrentGenerationTopicLoaded(state);
      expect(isLoaded).toBe(false);
    });

    it('should return false if batches map has non-array value', () => {
      const state = merge(initialStore, {
        activeGenerationTopicId: 'topic-1',
        generationBatchesMap: {
          'topic-1': null as any, // Simulating incorrect data type
        },
      });

      const isLoaded = generationBatchSelectors.isCurrentGenerationTopicLoaded(state);
      expect(isLoaded).toBe(false);
    });
  });
});
