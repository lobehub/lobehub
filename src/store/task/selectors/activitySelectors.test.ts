import type { TaskDetailActivity, TaskDetailData } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { TaskStoreState } from '../initialState';
import { initialState } from '../initialState';
import { taskActivitySelectors } from './activitySelectors';

const createActivity = (
  overrides: Partial<TaskDetailActivity> & { type: TaskDetailActivity['type'] },
): TaskDetailActivity => ({
  time: '2026-04-01T00:00:00Z',
  ...overrides,
});

const mockDetail: TaskDetailData = {
  activities: [
    createActivity({ id: 'a1', time: '2026-04-01T10:00:00Z', title: 'Topic 1', type: 'topic' }),
    createActivity({
      briefType: 'decision',
      id: 'a2',
      resolvedAction: null,
      time: '2026-04-01T11:00:00Z',
      type: 'brief',
    }),
    createActivity({
      content: 'A comment',
      id: 'a3',
      time: '2026-04-01T09:00:00Z',
      type: 'comment',
    }),
    createActivity({
      briefType: 'result',
      id: 'a4',
      resolvedAction: 'approve',
      time: '2026-04-01T12:00:00Z',
      type: 'brief',
    }),
  ],
  identifier: 'T-1',
  instruction: 'Test',
  status: 'paused',
};

const createState = (overrides: Partial<TaskStoreState> = {}): TaskStoreState => ({
  ...initialState,
  activeTaskId: 'T-1',
  taskDetailMap: { 'T-1': mockDetail },
  ...overrides,
});

describe('taskActivitySelectors', () => {
  describe('activeTaskActivities', () => {
    it('should return activities sorted by time (oldest first)', () => {
      const result = taskActivitySelectors.activeTaskActivities(createState());
      expect(result[0].id).toBe('a3'); // 09:00
      expect(result[1].id).toBe('a1'); // 10:00
      expect(result[2].id).toBe('a2'); // 11:00
      expect(result[3].id).toBe('a4'); // 12:00
    });

    it('should return empty array when no active task', () => {
      const state = createState({ activeTaskId: undefined });
      expect(taskActivitySelectors.activeTaskActivities(state)).toEqual([]);
    });

    it('should return empty array when no activities', () => {
      const state = createState({
        taskDetailMap: {
          'T-1': { ...mockDetail, activities: undefined },
        },
      });
      expect(taskActivitySelectors.activeTaskActivities(state)).toEqual([]);
    });
  });

  describe('filtered selectors', () => {
    const state = createState();

    it('should filter briefs', () => {
      const briefs = taskActivitySelectors.activeTaskBriefs(state);
      expect(briefs).toHaveLength(2);
      expect(briefs.every((b) => b.type === 'brief')).toBe(true);
    });

    it('should filter topics', () => {
      const topics = taskActivitySelectors.activeTaskTopics(state);
      expect(topics).toHaveLength(1);
      expect(topics[0].type).toBe('topic');
    });

    it('should filter comments', () => {
      const comments = taskActivitySelectors.activeTaskComments(state);
      expect(comments).toHaveLength(1);
      expect(comments[0].type).toBe('comment');
    });
  });

  describe('unresolvedBriefCount', () => {
    it('should count unresolved briefs', () => {
      // a2 has resolvedAction: null, a4 has resolvedAction: 'approve'
      expect(taskActivitySelectors.unresolvedBriefCount(createState())).toBe(1);
    });

    it('should return 0 when all briefs resolved', () => {
      const state = createState({
        taskDetailMap: {
          'T-1': {
            ...mockDetail,
            activities: [
              createActivity({
                briefType: 'result',
                id: 'a1',
                resolvedAction: 'approve',
                type: 'brief',
              }),
            ],
          },
        },
      });
      expect(taskActivitySelectors.unresolvedBriefCount(state)).toBe(0);
    });
  });

  describe('hasUnresolvedBriefs', () => {
    it('should return true when unresolved briefs exist', () => {
      expect(taskActivitySelectors.hasUnresolvedBriefs(createState())).toBe(true);
    });

    it('should return false when no unresolved briefs', () => {
      const state = createState({
        taskDetailMap: {
          'T-1': { ...mockDetail, activities: [] },
        },
      });
      expect(taskActivitySelectors.hasUnresolvedBriefs(state)).toBe(false);
    });
  });
});
