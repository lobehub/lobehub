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

  describe('replaceTopicId', () => {
    it('should keep the optimistic topic row while replacing its id', () => {
      state.push(
        {
          createdAt: 1,
          id: 'tmp-topic',
          title: 'User input',
          updatedAt: 1,
        },
        {
          createdAt: 2,
          id: 'older-topic',
          title: 'Older',
          updatedAt: 2,
        },
      );

      const payload: ChatTopicDispatch = {
        id: 'tmp-topic',
        nextId: 'real-topic',
        type: 'replaceTopicId',
        value: { sessionId: 'agent-1' },
      };

      const newState = topicReducer(state, payload);

      expect(newState).toHaveLength(2);
      expect(newState[0]).toEqual(
        expect.objectContaining({
          id: 'real-topic',
          sessionId: 'agent-1',
          title: 'User input',
        }),
      );
      expect(newState[1].id).toBe('older-topic');
    });

    it('should merge and remove an existing real topic row', () => {
      state.push(
        {
          createdAt: 1,
          id: 'tmp-topic',
          title: 'User input',
          updatedAt: 1,
        },
        {
          createdAt: 2,
          id: 'real-topic',
          title: 'Server title',
          updatedAt: 2,
        },
      );

      const newState = topicReducer(state, {
        id: 'tmp-topic',
        nextId: 'real-topic',
        type: 'replaceTopicId',
      });

      expect(newState).toHaveLength(1);
      expect(newState[0]).toEqual(
        expect.objectContaining({
          id: 'real-topic',
          title: 'Server title',
        }),
      );
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

      topicReducer(state, payload);

      expect(state).toEqual([]);
    });
  });
});
