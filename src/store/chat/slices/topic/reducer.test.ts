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

    it('should prefer caller-provided createdAt/updatedAt/favorite over Date.now()/false', () => {
      // Server-supplied timestamps must win so the side-bar order matches
      // the next SWR fetch result.
      const createdAt = new Date('2026-05-09T15:00:00Z');
      const updatedAt = new Date('2026-05-09T15:00:01Z');
      const payload: ChatTopicDispatch = {
        type: 'addTopic',
        value: {
          createdAt,
          favorite: true,
          id: 'tpc_server',
          title: 'From Server',
          updatedAt,
        },
      };

      const newState = topicReducer(state, payload);

      expect(newState[0].id).toBe('tpc_server');
      expect(newState[0].createdAt).toBe(createdAt);
      expect(newState[0].updatedAt).toBe(updatedAt);
      expect(newState[0].favorite).toBe(true);
    });

    it('should fall back to Date.now()/false when caller omits the optional fields', () => {
      // Existing optimistic `internal_createTopic` callers only know the title.
      const before = Date.now();
      const payload: ChatTopicDispatch = {
        type: 'addTopic',
        value: { title: 'Local Optimistic' },
      };

      const newState = topicReducer(state, payload);
      const after = Date.now();

      expect(newState[0].favorite).toBe(false);
      expect(typeof newState[0].createdAt).toBe('number');
      expect(typeof newState[0].updatedAt).toBe('number');
      expect(newState[0].createdAt as number).toBeGreaterThanOrEqual(before);
      expect(newState[0].createdAt as number).toBeLessThanOrEqual(after);
    });

    it('should keep favorite topics ahead of newly prepended non-favorite topic', () => {
      // Sort invariant: favorites stay on top regardless of insertion order.
      const favTopic: ChatTopic = {
        id: 'fav',
        title: 'Pinned',
        favorite: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const newState = topicReducer([favTopic], {
        type: 'addTopic',
        value: { id: 'fresh', title: 'Just Created' },
      });

      expect(newState[0].id).toBe('fav');
      expect(newState[1].id).toBe('fresh');
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
