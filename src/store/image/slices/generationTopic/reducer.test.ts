import { describe, expect, it } from 'vitest';

import { type ImageGenerationTopic } from '@/types/generation';

import { type GenerationTopicDispatch } from './reducer';
import { generationTopicReducer } from './reducer';

describe('generationTopicReducer', () => {
  let state: ImageGenerationTopic[];

  beforeEach(() => {
    state = [];
  });

  describe('addTopic', () => {
    it('should add a new topic to the state', () => {
      const newTopic: Partial<ImageGenerationTopic> & { id: string } = {
        id: 'gt_new_topic',
        title: 'New Topic',
      };
      const payload: GenerationTopicDispatch = { type: 'addTopic', value: newTopic };

      const newState = generationTopicReducer(state, payload);

      expect(newState).toHaveLength(1);
      expect(newState[0]).toMatchObject(newTopic);
      expect(newState[0].createdAt).toBeInstanceOf(Date);
      expect(newState[0].updatedAt).toBeInstanceOf(Date);
    });

    it('should prepend the new topic to the beginning of the array', () => {
      const initialTopic: ImageGenerationTopic = {
        id: 'gt_initial_topic',
        title: 'Initial Topic',
        createdAt: new Date('2023-01-01'),
        updatedAt: new Date('2023-01-01'),
      };
      state = [initialTopic];

      const newTopic: Partial<ImageGenerationTopic> & { id: string } = {
        id: 'gt_new_topic',
        title: 'New Topic',
      };
      const payload: GenerationTopicDispatch = { type: 'addTopic', value: newTopic };

      const newState = generationTopicReducer(state, payload);

      expect(newState).toHaveLength(2);
      expect(newState[0].id).toBe('gt_new_topic');
      expect(newState[1].id).toBe('gt_initial_topic');
    });
  });

  describe('updateTopic', () => {
    beforeEach(() => {
      state = [
        {
          id: 'gt_topic_to_update',
          title: 'Original Title',
          coverUrl: 'original_url',
          createdAt: new Date('2023-01-01'),
          updatedAt: new Date('2023-01-01'),
        },
      ];
    });

    it('should update the title of a specific topic', () => {
      const payload: GenerationTopicDispatch = {
        type: 'updateTopic',
        id: 'gt_topic_to_update',
        value: { title: 'Updated Title' },
      };

      const newState = generationTopicReducer(state, payload);

      expect(newState[0].title).toBe('Updated Title');
      expect(newState[0].coverUrl).toBe('original_url'); // Should not change
      expect(newState[0].updatedAt.valueOf()).toBeGreaterThan(state[0].updatedAt.valueOf());
    });

    it('should update the coverUrl of a specific topic', () => {
      const payload: GenerationTopicDispatch = {
        type: 'updateTopic',
        id: 'gt_topic_to_update',
        value: { coverUrl: 'updated_url' },
      };

      const newState = generationTopicReducer(state, payload);

      expect(newState[0].coverUrl).toBe('updated_url');
      expect(newState[0].title).toBe('Original Title'); // Should not change
    });

    it('should not change state if topic id is not found', () => {
      const payload: GenerationTopicDispatch = {
        type: 'updateTopic',
        id: 'gt_non_existent_topic',
        value: { title: 'Updated Title' },
      };

      const newState = generationTopicReducer(state, payload);

      expect(newState).toEqual(state);
    });
  });

  describe('deleteTopic', () => {
    beforeEach(() => {
      state = [
        {
          id: 'gt_topic_1',
          title: 'Topic 1',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'gt_topic_2',
          title: 'Topic 2',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
    });

    it('should delete the specified topic from the state', () => {
      const payload: GenerationTopicDispatch = { type: 'deleteTopic', id: 'gt_topic_1' };

      const newState = generationTopicReducer(state, payload);

      expect(newState).toHaveLength(1);
      expect(newState.find((t) => t.id === 'gt_topic_1')).toBeUndefined();
      expect(newState[0].id).toBe('gt_topic_2');
    });

    it('should not modify state if topic id is not found', () => {
      const payload: GenerationTopicDispatch = { type: 'deleteTopic', id: 'gt_non_existent' };

      const newState = generationTopicReducer(state, payload);

      expect(newState).toHaveLength(2);
      expect(newState).toEqual(state);
    });
  });

  describe('default case', () => {
    it('should return the original state for an unknown action type', () => {
      const payload = { type: 'unknown' } as any;

      const newState = generationTopicReducer(state, payload);

      expect(newState).toBe(state);
    });
  });

  describe('immutability', () => {
    it('should return a new state object for addTopic', () => {
      const payload: GenerationTopicDispatch = {
        type: 'addTopic',
        value: { id: 'test', title: 'Test' },
      };
      const newState = generationTopicReducer(state, payload);
      expect(newState).not.toBe(state);
    });

    it('should return a new state object for updateTopic', () => {
      state = [{ id: 'test', title: 'Test', createdAt: new Date(), updatedAt: new Date() }];
      const payload: GenerationTopicDispatch = {
        type: 'updateTopic',
        id: 'test',
        value: { title: 'Updated' },
      };
      const newState = generationTopicReducer(state, payload);
      expect(newState).not.toBe(state);
    });

    it('should return a new state object for deleteTopic', () => {
      state = [{ id: 'test', title: 'Test', createdAt: new Date(), updatedAt: new Date() }];
      const payload: GenerationTopicDispatch = { type: 'deleteTopic', id: 'test' };
      const newState = generationTopicReducer(state, payload);
      expect(newState).not.toBe(state);
    });

    it('should not modify the original state object', () => {
      const date = new Date();
      const originalState = [{ id: 'a', title: 'A', createdAt: date, updatedAt: date }];
      const stateCopy = [{ id: 'a', title: 'A', createdAt: date, updatedAt: date }];
      const stateRef = originalState;

      const payload: GenerationTopicDispatch = {
        type: 'addTopic',
        value: { id: 'b', title: 'B' },
      };
      generationTopicReducer(originalState, payload);

      expect(originalState).toEqual(stateCopy);
      expect(originalState).toBe(stateRef);
    });
  });
});
