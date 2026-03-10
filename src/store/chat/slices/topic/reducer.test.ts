import { expect } from 'vitest';

import { type ChatTopic } from '@/types/topic';

import { type ChatTopicDispatch } from './reducer';
import { topicReducer } from './reducer';

describe('topicReducer', () => {
  let state: ChatTopic[];

  beforeEach(() => {
    state = [];
  });

  describe('addTopic', () => {
    it('should add a new ChatTopic object to state', () => {
      const payload: ChatTopicDispatch = {
        type: 'addTopic',
        value: {
          title: 'Test Topic',
          sessionId: '',
        },
      };

      const newState = topicReducer(state, payload);

      expect(newState[0].id).toBeDefined();
    });
  });

  describe('updateTopic', () => {
    it('should update the ChatTopic object in state', () => {
      const topic: ChatTopic = {
        id: '1',
        title: 'Test Topic',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      state.push(topic);

      const payload: ChatTopicDispatch = {
        type: 'updateTopic',
        id: '1',
        value: { title: 'Updated Topic' },
      };

      const newState = topicReducer(state, payload);

      expect(newState[0].title).toBe('Updated Topic');
    });

    it('should update the ChatTopic object with correct properties', () => {
      const topic: ChatTopic = {
        id: '1',
        title: 'Test Topic',
        createdAt: Date.now() - 1,
        updatedAt: Date.now() - 1, // 设定比当前时间前面一点
      };

      state.push(topic);

      const payload: ChatTopicDispatch = {
        type: 'updateTopic',
        id: '1',
        value: { title: 'Updated Topic' },
      };

      const newState = topicReducer(state, payload);

      expect((newState[0].updatedAt as unknown as Date).valueOf()).toBeGreaterThan(topic.updatedAt);
    });
  });

  describe('deleteTopic', () => {
    it('should delete the specified ChatTopic object from state', () => {
      const topic: ChatTopic = {
        id: '1',
        title: 'Test Topic',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      state.push(topic);

      const payload: ChatTopicDispatch = {
        type: 'deleteTopic',
        id: '1',
      };

      const newState = topicReducer(state, payload);

      expect(newState).toEqual([]);
    });
  });

  describe('default', () => {
    it('should return the original state object', () => {
      const payload = {
        type: 'unknown',
      } as unknown as ChatTopicDispatch;

      const newState = topicReducer(state, payload);

      expect(newState).toBe(state);
    });
  });

  describe('produce', () => {
    it('should generate immutable state object', () => {
      const payload: ChatTopicDispatch = {
        type: 'addTopic',
        value: {
          title: 'Test Topic',
          sessionId: '1',
        },
      };

      const newState = topicReducer(state, payload);

      expect(newState).not.toBe(state);
    });

    it('should not modify the original state object', () => {
      const payload: ChatTopicDispatch = {
        type: 'addTopic',
        value: {
          title: 'Test Topic',

          sessionId: '123',
        },
      };

      const newState = topicReducer(state, payload);

      expect(state).toEqual([]);
    });
  });
});
