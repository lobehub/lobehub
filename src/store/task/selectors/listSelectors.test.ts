import { describe, expect, it } from 'vitest';

import type { TaskStoreState } from '../initialState';
import { initialState } from '../initialState';
import { taskListSelectors } from './listSelectors';

const createState = (overrides: Partial<TaskStoreState> = {}): TaskStoreState => ({
  ...initialState,
  ...overrides,
});

describe('taskListSelectors', () => {
  describe('getDisplayStatus', () => {
    it('should map backend statuses to UI labels', () => {
      expect(taskListSelectors.getDisplayStatus('backlog')).toBe('Backlog');
      expect(taskListSelectors.getDisplayStatus('running')).toBe('In progress');
      expect(taskListSelectors.getDisplayStatus('paused')).toBe('Needs input');
      expect(taskListSelectors.getDisplayStatus('failed')).toBe('Needs input');
      expect(taskListSelectors.getDisplayStatus('completed')).toBe('Done');
      expect(taskListSelectors.getDisplayStatus('canceled')).toBe('Canceled');
    });

    it('should return raw status for unknown values', () => {
      expect(taskListSelectors.getDisplayStatus('unknown')).toBe('unknown');
    });
  });

  describe('keyed collections', () => {
    const groups = [{ key: 'backlog', tasks: [{ identifier: 'T-1' }], total: 1 }] as any[];
    const state = createState({
      taskGroupListMap: { board: { groupBy: 'status', groups } },
      taskListMap: {
        empty: { items: [], total: 0 },
        home: { items: [{ identifier: 'T-1' }] as any[], total: 42 },
      },
    });

    it("reads one list by its query key, never another surface's rows", () => {
      expect(taskListSelectors.taskList('home')(state)).toHaveLength(1);
      expect(taskListSelectors.taskListTotal('home')(state)).toBe(42);
      expect(taskListSelectors.taskList('tasks-page')(state)).toEqual([]);
      expect(taskListSelectors.taskList(undefined)(state)).toEqual([]);
    });

    it('settles per query key', () => {
      expect(taskListSelectors.isTaskListInit('home')(state)).toBe(true);
      expect(taskListSelectors.isTaskListInit('tasks-page')(state)).toBe(false);
      expect(taskListSelectors.isTaskGroupListInit('board')(state)).toBe(true);
      expect(taskListSelectors.taskGroups('board')(state)).toBe(groups);
      expect(taskListSelectors.taskGroups('other')(state)).toEqual([]);
    });

    it('is empty only for a settled list without rows', () => {
      expect(taskListSelectors.isListEmpty('empty')(state)).toBe(true);
      expect(taskListSelectors.isListEmpty('home')(state)).toBe(false);
      expect(taskListSelectors.isListEmpty('tasks-page')(state)).toBe(false);
    });
  });
});
