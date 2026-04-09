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

  describe('kanban column selectors (from taskGroups)', () => {
    const taskGroups = [
      {
        hasMore: false,
        key: 'backlog',
        limit: 50,
        offset: 0,
        tasks: [{ identifier: 'T-1', status: 'backlog' }],
        total: 1,
      },
      {
        hasMore: false,
        key: 'running',
        limit: 50,
        offset: 0,
        tasks: [
          { identifier: 'T-2', status: 'running' },
          { identifier: 'T-7', status: 'running' },
        ],
        total: 2,
      },
      {
        hasMore: false,
        key: 'needsInput',
        limit: 50,
        offset: 0,
        tasks: [
          { identifier: 'T-3', status: 'paused' },
          { identifier: 'T-4', status: 'failed' },
        ],
        total: 2,
      },
      {
        hasMore: false,
        key: 'done',
        limit: 50,
        offset: 0,
        tasks: [{ identifier: 'T-5', status: 'completed' }],
        total: 1,
      },
    ] as any[];

    const state = createState({ taskGroups });

    it('should return backlog tasks from group', () => {
      const result = taskListSelectors.backlogTasks(state);
      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe('T-1');
    });

    it('should return running tasks from group', () => {
      const result = taskListSelectors.runningTasks(state);
      expect(result).toHaveLength(2);
    });

    it('should return needsInput tasks from group', () => {
      const result = taskListSelectors.needsInputTasks(state);
      expect(result).toHaveLength(2);
      expect(result.map((t: any) => t.identifier)).toEqual(['T-3', 'T-4']);
    });

    it('should return done tasks from group', () => {
      const result = taskListSelectors.doneTasks(state);
      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe('T-5');
    });

    it('should return empty array for missing group', () => {
      const emptyState = createState({ taskGroups: [] });
      expect(taskListSelectors.backlogTasks(emptyState)).toEqual([]);
      expect(taskListSelectors.runningTasks(emptyState)).toEqual([]);
    });

    it('should return group by key', () => {
      const group = taskListSelectors.taskGroupByKey('running')(state);
      expect(group?.total).toBe(2);
      expect(group?.hasMore).toBe(false);
    });
  });

  describe('isListEmpty', () => {
    it('should return false when not initialized', () => {
      expect(taskListSelectors.isListEmpty(createState())).toBe(false);
    });

    it('should return true when initialized with empty list', () => {
      expect(taskListSelectors.isListEmpty(createState({ isTaskListInit: true, tasks: [] }))).toBe(
        true,
      );
    });

    it('should return false when initialized with tasks', () => {
      expect(
        taskListSelectors.isListEmpty(
          createState({ isTaskListInit: true, tasks: [{ identifier: 'T-1' }] as any[] }),
        ),
      ).toBe(false);
    });
  });

  describe('basic selectors', () => {
    it('should return viewMode', () => {
      expect(taskListSelectors.viewMode(createState({ viewMode: 'kanban' }))).toBe('kanban');
    });

    it('should return isTaskListInit', () => {
      expect(taskListSelectors.isTaskListInit(createState({ isTaskListInit: true }))).toBe(true);
    });

    it('should return taskListTotal', () => {
      expect(taskListSelectors.taskListTotal(createState({ tasksTotal: 42 }))).toBe(42);
    });

    it('should return isTaskGroupListInit', () => {
      expect(
        taskListSelectors.isTaskGroupListInit(createState({ isTaskGroupListInit: true })),
      ).toBe(true);
    });
  });
});
