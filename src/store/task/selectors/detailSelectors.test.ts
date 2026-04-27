import type { TaskDetailData } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { TaskStoreState } from '../initialState';
import { initialState } from '../initialState';
import { taskDetailSelectors } from './detailSelectors';

const mockDetail: TaskDetailData = {
  agentId: 'agt_1',
  checkpoint: { onAgentRequest: true },
  config: { model: 'gpt-4o', provider: 'openai' },
  dependencies: [{ dependsOn: 'T-2', type: 'blocks' }],
  description: 'A test task',
  error: null,
  heartbeat: { interval: 300, timeout: null },
  identifier: 'T-1',
  instruction: 'Do something',
  name: 'Test Task',
  parent: { identifier: 'T-0', name: 'Parent' },
  priority: 2,
  review: { enabled: false },
  status: 'running',
  subtasks: [{ identifier: 'T-1-1', name: 'Sub', status: 'backlog' }],
  topicCount: 3,
  workspace: [],
};

const createState = (overrides: Partial<TaskStoreState> = {}): TaskStoreState => ({
  ...initialState,
  ...overrides,
});

describe('taskDetailSelectors', () => {
  describe('activeTaskDetail', () => {
    it('should return undefined when no active task', () => {
      const state = createState();
      expect(taskDetailSelectors.activeTaskDetail(state)).toBeUndefined();
    });

    it('should return detail from map when activeTaskId is set', () => {
      const state = createState({
        activeTaskId: 'T-1',
        taskDetailMap: { 'T-1': mockDetail },
      });
      expect(taskDetailSelectors.activeTaskDetail(state)).toEqual(mockDetail);
    });
  });

  describe('field selectors', () => {
    const state = createState({
      activeTaskId: 'T-1',
      taskDetailMap: { 'T-1': mockDetail },
    });

    it('should return activeTaskName', () => {
      expect(taskDetailSelectors.activeTaskName(state)).toBe('Test Task');
    });

    it('should return activeTaskStatus', () => {
      expect(taskDetailSelectors.activeTaskStatus(state)).toBe('running');
    });

    it('should return activeTaskPriority', () => {
      expect(taskDetailSelectors.activeTaskPriority(state)).toBe(2);
    });

    it('should return default priority when no detail', () => {
      expect(taskDetailSelectors.activeTaskPriority(createState())).toBe(0);
    });

    it('should return activeTaskInstruction', () => {
      expect(taskDetailSelectors.activeTaskInstruction(state)).toBe('Do something');
    });

    it('should return activeTaskAgentId', () => {
      expect(taskDetailSelectors.activeTaskAgentId(state)).toBe('agt_1');
    });

    it('should return activeTaskModel', () => {
      expect(taskDetailSelectors.activeTaskModel(state)).toBe('gpt-4o');
    });

    it('should return activeTaskProvider', () => {
      expect(taskDetailSelectors.activeTaskProvider(state)).toBe('openai');
    });

    it('should return undefined model/provider when no config', () => {
      const noConfigState = createState({
        activeTaskId: 'T-1',
        taskDetailMap: { 'T-1': { ...mockDetail, config: undefined } },
      });
      expect(taskDetailSelectors.activeTaskModel(noConfigState)).toBeUndefined();
      expect(taskDetailSelectors.activeTaskProvider(noConfigState)).toBeUndefined();
    });

    it('should return activeTaskPeriodicInterval from heartbeat', () => {
      expect(taskDetailSelectors.activeTaskPeriodicInterval(state)).toBe(300);
    });

    it('should return 0 for periodicInterval when no heartbeat', () => {
      const noHbState = createState({
        activeTaskId: 'T-1',
        taskDetailMap: { 'T-1': { ...mockDetail, heartbeat: undefined } },
      });
      expect(taskDetailSelectors.activeTaskPeriodicInterval(noHbState)).toBe(0);
    });

    it('should return activeTaskSubtasks', () => {
      expect(taskDetailSelectors.activeTaskSubtasks(state)).toHaveLength(1);
    });

    it('should return empty array when no subtasks', () => {
      expect(taskDetailSelectors.activeTaskSubtasks(createState())).toEqual([]);
    });

    it('should return activeTaskParent', () => {
      expect(taskDetailSelectors.activeTaskParent(state)?.identifier).toBe('T-0');
    });

    it('should return activeTaskTopicCount', () => {
      expect(taskDetailSelectors.activeTaskTopicCount(state)).toBe(3);
    });
  });

  describe('canRunActiveTask', () => {
    it('should return true for backlog task with agentId', () => {
      const state = createState({
        activeTaskId: 'T-1',
        taskDetailMap: { 'T-1': { ...mockDetail, status: 'backlog' } },
      });
      expect(taskDetailSelectors.canRunActiveTask(state)).toBe(true);
    });

    it('should return true for paused task with agentId', () => {
      const state = createState({
        activeTaskId: 'T-1',
        taskDetailMap: { 'T-1': { ...mockDetail, status: 'paused' } },
      });
      expect(taskDetailSelectors.canRunActiveTask(state)).toBe(true);
    });

    it('should return true for failed task with agentId', () => {
      const state = createState({
        activeTaskId: 'T-1',
        taskDetailMap: { 'T-1': { ...mockDetail, status: 'failed' } },
      });
      expect(taskDetailSelectors.canRunActiveTask(state)).toBe(true);
    });

    it('should return false for running task', () => {
      const state = createState({
        activeTaskId: 'T-1',
        taskDetailMap: { 'T-1': { ...mockDetail, status: 'running' } },
      });
      expect(taskDetailSelectors.canRunActiveTask(state)).toBe(false);
    });

    it('should return true when no agentId is assigned yet', () => {
      const state = createState({
        activeTaskId: 'T-1',
        taskDetailMap: { 'T-1': { ...mockDetail, agentId: null, status: 'backlog' } },
      });
      expect(taskDetailSelectors.canRunActiveTask(state)).toBe(true);
    });
  });

  describe('canPauseActiveTask', () => {
    it('should return true for running task', () => {
      const state = createState({
        activeTaskId: 'T-1',
        taskDetailMap: { 'T-1': { ...mockDetail, status: 'running' } },
      });
      expect(taskDetailSelectors.canPauseActiveTask(state)).toBe(true);
    });

    it('should return false for non-running task', () => {
      const state = createState({
        activeTaskId: 'T-1',
        taskDetailMap: { 'T-1': { ...mockDetail, status: 'paused' } },
      });
      expect(taskDetailSelectors.canPauseActiveTask(state)).toBe(false);
    });
  });

  describe('canCancelActiveTask', () => {
    it.each(['running', 'paused', 'backlog'] as const)(
      'should return true for %s task',
      (status) => {
        const state = createState({
          activeTaskId: 'T-1',
          taskDetailMap: { 'T-1': { ...mockDetail, status } },
        });
        expect(taskDetailSelectors.canCancelActiveTask(state)).toBe(true);
      },
    );

    it.each(['completed', 'canceled'] as const)('should return false for %s task', (status) => {
      const state = createState({
        activeTaskId: 'T-1',
        taskDetailMap: { 'T-1': { ...mockDetail, status } },
      });
      expect(taskDetailSelectors.canCancelActiveTask(state)).toBe(false);
    });
  });

  describe('isTaskDetailLoading', () => {
    it('should return true when no activeTaskId', () => {
      expect(taskDetailSelectors.isTaskDetailLoading(createState())).toBe(true);
    });

    it('should return true when detail not in map', () => {
      const state = createState({ activeTaskId: 'T-1', taskDetailMap: {} });
      expect(taskDetailSelectors.isTaskDetailLoading(state)).toBe(true);
    });

    it('should return false when detail exists', () => {
      const state = createState({
        activeTaskId: 'T-1',
        taskDetailMap: { 'T-1': mockDetail },
      });
      expect(taskDetailSelectors.isTaskDetailLoading(state)).toBe(false);
    });
  });

  describe('taskDetailById', () => {
    it('should return detail for given id', () => {
      const state = createState({ taskDetailMap: { 'T-1': mockDetail } });
      expect(taskDetailSelectors.taskDetailById('T-1')(state)).toEqual(mockDetail);
    });

    it('should return undefined for missing id', () => {
      const state = createState({ taskDetailMap: {} });
      expect(taskDetailSelectors.taskDetailById('T-999')(state)).toBeUndefined();
    });
  });
});
