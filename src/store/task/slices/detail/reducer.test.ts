import type { TaskDetailData } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { TaskDetailDispatch } from './reducer';
import { taskDetailReducer } from './reducer';

const mockDetail: TaskDetailData = {
  identifier: 'T-1',
  instruction: 'Test instruction',
  name: 'Test Task',
  priority: 3,
  status: 'backlog',
};

const mockDetail2: TaskDetailData = {
  identifier: 'T-2',
  instruction: 'Another instruction',
  name: 'Another Task',
  status: 'running',
};

describe('taskDetailReducer', () => {
  describe('setTaskDetail', () => {
    it('should set a new task detail entry', () => {
      const state: Record<string, TaskDetailData> = {};
      const result = taskDetailReducer(state, {
        id: 'T-1',
        type: 'setTaskDetail',
        value: mockDetail,
      });

      expect(result['T-1']).toEqual(mockDetail);
    });

    it('should overwrite an existing entry', () => {
      const state: Record<string, TaskDetailData> = { 'T-1': mockDetail };
      const updated = { ...mockDetail, name: 'Updated Name' };
      const result = taskDetailReducer(state, {
        id: 'T-1',
        type: 'setTaskDetail',
        value: updated,
      });

      expect(result['T-1'].name).toBe('Updated Name');
    });

    it('should not affect other entries', () => {
      const state: Record<string, TaskDetailData> = { 'T-1': mockDetail };
      const result = taskDetailReducer(state, {
        id: 'T-2',
        type: 'setTaskDetail',
        value: mockDetail2,
      });

      expect(result['T-1']).toEqual(mockDetail);
      expect(result['T-2']).toEqual(mockDetail2);
    });
  });

  describe('updateTaskDetail', () => {
    it('should merge partial data into an existing entry', () => {
      const state: Record<string, TaskDetailData> = { 'T-1': mockDetail };
      const result = taskDetailReducer(state, {
        id: 'T-1',
        type: 'updateTaskDetail',
        value: { name: 'Updated', priority: 1 },
      });

      expect(result['T-1'].name).toBe('Updated');
      expect(result['T-1'].priority).toBe(1);
      expect(result['T-1'].instruction).toBe('Test instruction');
    });

    it('should not create entry if it does not exist', () => {
      const state: Record<string, TaskDetailData> = {};
      const result = taskDetailReducer(state, {
        id: 'T-999',
        type: 'updateTaskDetail',
        value: { name: 'Ghost' },
      });

      expect(result['T-999']).toBeUndefined();
    });
  });

  describe('deleteTaskDetail', () => {
    it('should remove an existing entry', () => {
      const state: Record<string, TaskDetailData> = {
        'T-1': mockDetail,
        'T-2': mockDetail2,
      };
      const result = taskDetailReducer(state, {
        id: 'T-1',
        type: 'deleteTaskDetail',
      });

      expect(result['T-1']).toBeUndefined();
      expect(result['T-2']).toEqual(mockDetail2);
    });

    it('should return state unchanged if id does not exist', () => {
      const state: Record<string, TaskDetailData> = { 'T-1': mockDetail };
      const result = taskDetailReducer(state, {
        id: 'T-999',
        type: 'deleteTaskDetail',
      });

      expect(result['T-1']).toEqual(mockDetail);
    });
  });

  it('should return state for unknown action type', () => {
    const state: Record<string, TaskDetailData> = { 'T-1': mockDetail };
    const result = taskDetailReducer(state, {
      id: 'T-1',
      type: 'unknown' as any,
    } as TaskDetailDispatch);

    expect(result).toBe(state);
  });
});
