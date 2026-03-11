import { AsyncTaskStatus } from '@/types/asyncTask';
import { type Generation, type GenerationBatch } from '@/types/generation';

import { type GenerationBatchDispatch } from './reducer';
import { generationBatchReducer } from './reducer';

// Test data factory functions
const createMockGeneration = (overrides: Partial<Generation> = {}): Generation => ({
  id: 'gen1',
  asset: {
    type: 'image',
    originalUrl: 'https://example.com/image1.jpg',
    url: 'files/image1.jpg',
    thumbnailUrl: 'files/image1_thumb.jpg',
    width: 1024,
    height: 1024,
  },
  seed: 12345,
  asyncTaskId: 'task1',
  createdAt: new Date('2024-01-01'),
  task: {
    id: 'task1',
    status: AsyncTaskStatus.Success,
  },
  ...overrides,
});

const createMockGenerationBatch = (overrides: Partial<GenerationBatch> = {}): GenerationBatch => ({
  id: 'batch1',
  provider: 'openai',
  model: 'dall-e-3',
  prompt: 'A beautiful sunset',
  width: 1024,
  height: 1024,
  config: {
    prompt: 'A beautiful sunset',
    width: 1024,
    height: 1024,
  },
  generations: [],
  createdAt: new Date('2024-01-01'),
  ...overrides,
});

describe('generationBatchReducer', () => {
  let initialState: GenerationBatch[];

  beforeEach(() => {
    initialState = [
      createMockGenerationBatch({
        id: 'batch1',
        generations: [
          createMockGeneration({
            id: 'gen1',
          }),
          createMockGeneration({
            id: 'gen2',
            asset: {
              type: 'image',
              originalUrl: 'https://example.com/image2.jpg',
              url: 'files/image2.jpg',
              thumbnailUrl: 'files/image2_thumb.jpg',
              width: 1024,
              height: 1024,
            },
            seed: 67890,
            asyncTaskId: 'task2',
            task: {
              id: 'task2',
              status: AsyncTaskStatus.Success,
            },
          }),
        ],
      }),
      createMockGenerationBatch({
        id: 'batch2',
        provider: 'midjourney',
        model: 'mj-v6',
        prompt: 'A futuristic city',
        config: {
          prompt: 'A futuristic city',
          width: 1024,
          height: 1024,
        },
        generations: [
          createMockGeneration({
            id: 'gen3',
            asset: {
              type: 'image',
              originalUrl: 'https://example.com/image3.jpg',
              url: 'files/image3.jpg',
              thumbnailUrl: 'files/image3_thumb.jpg',
              width: 1024,
              height: 1024,
            },
            seed: 11111,
            asyncTaskId: 'task3',
            createdAt: new Date('2024-01-02'),
            task: {
              id: 'task3',
              status: AsyncTaskStatus.Success,
            },
          }),
        ],
        createdAt: new Date('2024-01-02'),
      }),
    ];
  });

  describe('updateGenerationInBatch', () => {
    it('should update the specified generation within a batch', () => {
      const payload: GenerationBatchDispatch = {
        type: 'updateGenerationInBatch',
        batchId: 'batch1',
        generationId: 'gen1',
        value: {
          asset: {
            type: 'image',
            url: 'files/newFile1.jpg',
            width: 2048,
            height: 2048,
          },
          seed: 99999,
        },
      };

      const newState = generationBatchReducer(initialState, payload);
      const updatedBatch = newState.find((batch) => batch.id === 'batch1');
      const updatedGeneration = updatedBatch?.generations.find((gen) => gen.id === 'gen1');

      expect(updatedGeneration).toBeDefined();
      expect(updatedGeneration?.asset?.url).toBe('files/newFile1.jpg');
      expect(updatedGeneration?.asset?.width).toBe(2048);
      expect(updatedGeneration?.seed).toBe(99999);
      // Ensure other properties remain unchanged
      expect(updatedGeneration?.asyncTaskId).toBe('task1');
    });

    it('should not modify the state if the batch is not found', () => {
      const payload: GenerationBatchDispatch = {
        type: 'updateGenerationInBatch',
        batchId: 'nonexistentBatch',
        generationId: 'gen1',
        value: { seed: 99999 },
      };

      const newState = generationBatchReducer(initialState, payload);
      expect(newState).toEqual(initialState);
    });

    it('should not modify the state if the generation is not found', () => {
      const payload: GenerationBatchDispatch = {
        type: 'updateGenerationInBatch',
        batchId: 'batch1',
        generationId: 'nonexistentGen',
        value: { seed: 99999 },
      };

      const newState = generationBatchReducer(initialState, payload);
      expect(newState).toEqual(initialState);
    });

    it('should only update the specified generation and not affect others', () => {
      const payload: GenerationBatchDispatch = {
        type: 'updateGenerationInBatch',
        batchId: 'batch1',
        generationId: 'gen1',
        value: { seed: 99999 },
      };

      const newState = generationBatchReducer(initialState, payload);
      const batch = newState.find((b) => b.id === 'batch1');
      const gen1 = batch?.generations.find((g) => g.id === 'gen1');
      const gen2 = batch?.generations.find((g) => g.id === 'gen2');

      expect(gen1?.seed).toBe(99999);
      expect(gen2?.seed).toBe(67890); // Unchanged
    });

    it('should update asset properties', () => {
      const payload: GenerationBatchDispatch = {
        type: 'updateGenerationInBatch',
        batchId: 'batch1',
        generationId: 'gen1',
        value: {
          asset: {
            type: 'image',
            originalUrl: 'https://example.com/new-image.jpg',
            url: 'files/new-image.jpg',
            thumbnailUrl: 'files/new-image_thumb.jpg',
            width: 2048,
            height: 2048,
          },
        },
      };

      const newState = generationBatchReducer(initialState, payload);
      const updatedGeneration = newState
        .find((batch) => batch.id === 'batch1')
        ?.generations.find((gen) => gen.id === 'gen1');

      expect(updatedGeneration?.asset).toEqual({
        type: 'image',
        originalUrl: 'https://example.com/new-image.jpg',
        url: 'files/new-image.jpg',
        thumbnailUrl: 'files/new-image_thumb.jpg',
        width: 2048,
        height: 2048,
      });
    });
  });

  describe('updateBatch', () => {
    it('should update the specified batch with the provided value', () => {
      const payload: GenerationBatchDispatch = {
        type: 'updateBatch',
        id: 'batch1',
        value: { prompt: 'Updated prompt', width: 2048 },
      };

      const newState = generationBatchReducer(initialState, payload);
      const updatedBatch = newState.find((batch) => batch.id === 'batch1');

      expect(updatedBatch).toBeDefined();
      expect(updatedBatch?.prompt).toBe('Updated prompt');
      expect(updatedBatch?.width).toBe(2048);
      // Ensure other properties remain unchanged
      expect(updatedBatch?.height).toBe(1024);
      expect(updatedBatch?.generations.length).toBe(2);
    });

    it('should not modify the state if the batch is not found', () => {
      const payload: GenerationBatchDispatch = {
        type: 'updateBatch',
        id: 'nonexistentBatch',
        value: { prompt: 'Updated prompt' },
      };

      const newState = generationBatchReducer(initialState, payload);
      expect(newState).toEqual(initialState);
    });

    it('should only update the specified batch and not affect others', () => {
      const payload: GenerationBatchDispatch = {
        type: 'updateBatch',
        id: 'batch1',
        value: { prompt: 'Updated prompt' },
      };

      const newState = generationBatchReducer(initialState, payload);
      const batch1 = newState.find((b) => b.id === 'batch1');
      const batch2 = newState.find((b) => b.id === 'batch2');

      expect(batch1?.prompt).toBe('Updated prompt');
      expect(batch2?.prompt).toBe('A futuristic city'); // Unchanged
    });

    it('should update config properties', () => {
      const payload: GenerationBatchDispatch = {
        type: 'updateBatch',
        id: 'batch1',
        value: {
          config: {
            prompt: 'Updated prompt with config',
            width: 2048,
            height: 2048,
            steps: 50,
            cfg: 7.5,
          },
        },
      };

      const newState = generationBatchReducer(initialState, payload);
      const updatedBatch = newState.find((batch) => batch.id === 'batch1');

      expect(updatedBatch?.config).toEqual({
        prompt: 'Updated prompt with config',
        width: 2048,
        height: 2048,
        steps: 50,
        cfg: 7.5,
      });
    });
  });

  describe('deleteBatch', () => {
    it('should remove the specified batch from the state', () => {
      const payload: GenerationBatchDispatch = {
        type: 'deleteBatch',
        id: 'batch1',
      };

      const newState = generationBatchReducer(initialState, payload);

      expect(newState.length).toBe(1);
      expect(newState.find((batch) => batch.id === 'batch1')).toBeUndefined();
      expect(newState.find((batch) => batch.id === 'batch2')).toBeDefined();
    });

    it('should not modify the state if the batch to delete is not found', () => {
      const payload: GenerationBatchDispatch = {
        type: 'deleteBatch',
        id: 'nonexistentBatch',
      };

      const newState = generationBatchReducer(initialState, payload);
      expect(newState).toEqual(initialState);
      expect(newState.length).toBe(2);
    });

    it('should handle deleting all batches', () => {
      const state1 = generationBatchReducer(initialState, {
        type: 'deleteBatch',
        id: 'batch1',
      });

      const state2 = generationBatchReducer(state1, {
        type: 'deleteBatch',
        id: 'batch2',
      });

      expect(state2.length).toBe(0);
    });
  });

  describe('deleteGenerationInBatch', () => {
    it('should remove the specified generation from a batch', () => {
      const payload: GenerationBatchDispatch = {
        type: 'deleteGenerationInBatch',
        batchId: 'batch1',
        generationId: 'gen1',
      };

      const newState = generationBatchReducer(initialState, payload);
      const updatedBatch = newState.find((batch) => batch.id === 'batch1');

      expect(updatedBatch?.generations.length).toBe(1);
      expect(updatedBatch?.generations.find((gen) => gen.id === 'gen1')).toBeUndefined();
      expect(updatedBatch?.generations.find((gen) => gen.id === 'gen2')).toBeDefined();
    });

    it('should not modify the state if the batch is not found', () => {
      const payload: GenerationBatchDispatch = {
        type: 'deleteGenerationInBatch',
        batchId: 'nonexistentBatch',
        generationId: 'gen1',
      };

      const newState = generationBatchReducer(initialState, payload);
      expect(newState).toEqual(initialState);
    });

    it('should not modify the state if the generation is not found', () => {
      const payload: GenerationBatchDispatch = {
        type: 'deleteGenerationInBatch',
        batchId: 'batch1',
        generationId: 'nonexistentGen',
      };

      const newState = generationBatchReducer(initialState, payload);
      const batch = newState.find((b) => b.id === 'batch1');
      expect(batch?.generations.length).toBe(2); // Still 2 generations
    });

    it('should handle deleting all generations from a batch', () => {
      const state1 = generationBatchReducer(initialState, {
        type: 'deleteGenerationInBatch',
        batchId: 'batch1',
        generationId: 'gen1',
      });

      const state2 = generationBatchReducer(state1, {
        type: 'deleteGenerationInBatch',
        batchId: 'batch1',
        generationId: 'gen2',
      });

      const batch = state2.find((b) => b.id === 'batch1');
      expect(batch?.generations.length).toBe(0);
    });
  });

  describe('addBatch', () => {
    it('should add a new batch to the state at the beginning', () => {
      const newBatch = createMockGenerationBatch({
        id: 'batch3',
        provider: 'anthropic',
        model: 'claude-3',
        prompt: 'A new generation',
        width: 512,
        height: 512,
        config: {
          prompt: 'A new generation',
          width: 512,
          height: 512,
        },
        createdAt: new Date('2024-01-03'),
      });

      const payload: GenerationBatchDispatch = {
        type: 'addBatch',
        value: newBatch,
      };

      const newState = generationBatchReducer(initialState, payload);

      expect(newState.length).toBe(3);
      expect(newState[0]).toEqual(newBatch); // New batch is at the beginning
      expect(newState[1]).toEqual(initialState[0]); // Original first batch is now second
    });

    it('should handle adding batch with generations', () => {
      const newBatch: GenerationBatch = {
        id: 'batch3',
        provider: 'midjourney',
        model: 'mj-v6',
        prompt: 'Complex scene',
        width: 1024,
        height: 1024,
        config: {
          prompt: 'Complex scene',
          width: 1024,
          height: 1024,
        },
        generations: [
          {
            id: 'gen4',
            asset: {
              type: 'image',
              originalUrl: 'https://example.com/image4.jpg',
              url: 'files/image4.jpg',
              thumbnailUrl: 'files/image4_thumb.jpg',
              width: 1024,
              height: 1024,
            },
            seed: 22222,
            asyncTaskId: 'task4',
            createdAt: new Date('2024-01-03'),
            task: {
              id: 'task4',
              status: AsyncTaskStatus.Pending,
            },
          },
        ],
        createdAt: new Date('2024-01-03'),
      };

      const payload: GenerationBatchDispatch = {
        type: 'addBatch',
        value: newBatch,
      };

      const newState = generationBatchReducer(initialState, payload);

      expect(newState.length).toBe(3);
      expect(newState[0].generations.length).toBe(1);
      expect(newState[0].generations[0].id).toBe('gen4');
    });

    it('should handle adding batch to empty state', () => {
      const newBatch: GenerationBatch = {
        id: 'batch1',
        provider: 'openai',
        model: 'dall-e-3',
        prompt: 'First batch',
        width: 1024,
        height: 1024,
        config: {
          prompt: 'First batch',
          width: 1024,
          height: 1024,
        },
        generations: [],
        createdAt: new Date('2024-01-01'),
      };

      const payload: GenerationBatchDispatch = {
        type: 'addBatch',
        value: newBatch,
      };

      const newState = generationBatchReducer([], payload);

      expect(newState.length).toBe(1);
      expect(newState[0]).toEqual(newBatch);
    });

    it('should handle adding batch with null values', () => {
      const newBatch: GenerationBatch = {
        id: 'batch4',
        provider: 'openai',
        model: 'dall-e-3',
        prompt: 'Test with nulls',
        width: null,
        height: null,
        config: {
          prompt: 'Test with nulls',
        },
        generations: [
          {
            id: 'gen5',
            asset: null,
            seed: null,
            asyncTaskId: null,
            createdAt: new Date('2024-01-04'),
            task: {
              id: 'task5',
              status: AsyncTaskStatus.Error,
              error: {
                name: 'GEN_ERROR',
                body: { detail: 'Generation failed' },
              },
            },
          },
        ],
        createdAt: new Date('2024-01-04'),
      };

      const payload: GenerationBatchDispatch = {
        type: 'addBatch',
        value: newBatch,
      };

      const newState = generationBatchReducer(initialState, payload);

      expect(newState.length).toBe(3);
      expect(newState[0].width).toBeNull();
      expect(newState[0].height).toBeNull();
      expect(newState[0].generations[0].asset).toBeNull();
      expect(newState[0].generations[0].seed).toBeNull();
    });
  });

  describe('default case', () => {
    it('should return the current state for unknown action types', () => {
      // @ts-expect-error - Testing unknown action type
      const payload: GenerationBatchDispatch = { type: 'unknownType' };

      const newState = generationBatchReducer(initialState, payload);
      expect(newState).toEqual(initialState);
    });
  });

  describe('edge cases', () => {
    it('should handle undefined state gracefully', () => {
      const payload: GenerationBatchDispatch = {
        type: 'addBatch',
        value: {
          id: 'batch1',
          provider: 'openai',
          model: 'dall-e-3',
          prompt: 'Test',
          width: 1024,
          height: 1024,
          config: {
            prompt: 'Test',
            width: 1024,
            height: 1024,
          },
          generations: [],
          createdAt: new Date(),
        },
      };

      const newState = generationBatchReducer(undefined, payload);
      expect(newState.length).toBe(1);
    });
  });
});
