import type { TaskDetailData } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { TaskDetailDispatch } from './reducer';
import { findSubtaskParentId, taskDetailReducer } from './reducer';

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

    describe('nested subtasks', () => {
      const buildParentWithSubtasks = (): TaskDetailData => ({
        identifier: 'T-3',
        instruction: 'Parent',
        name: 'Parent',
        status: 'backlog',
        subtasks: [
          {
            assignee: {
              avatar: 'old-avatar',
              backgroundColor: '#000',
              id: 'agent-old',
              title: 'Old Agent',
            },
            identifier: 'T-3.1',
            name: 'Sub 1',
            priority: 2,
            status: 'backlog',
          },
          {
            children: [
              {
                assignee: null,
                identifier: 'T-3.2.1',
                name: 'Nested',
                status: 'backlog',
              },
            ],
            identifier: 'T-3.2',
            name: 'Sub 2',
            status: 'backlog',
          },
        ],
      });

      it('should patch a subtask assignee.id when agentId is updated', () => {
        const state: Record<string, TaskDetailData> = { 'T-3': buildParentWithSubtasks() };
        const result = taskDetailReducer(state, {
          id: 'T-3.1',
          type: 'updateTaskDetail',
          value: { agentId: 'agent-new' },
        });

        const patched = result['T-3'].subtasks?.[0];
        expect(patched?.assignee?.id).toBe('agent-new');
        // Other assignee fields preserved (the avatar resolves reactively from agent store)
        expect(patched?.assignee?.title).toBe('Old Agent');
      });

      it('should create assignee object when patching agentId on subtask without assignee', () => {
        const state: Record<string, TaskDetailData> = { 'T-3': buildParentWithSubtasks() };
        const result = taskDetailReducer(state, {
          id: 'T-3.2.1',
          type: 'updateTaskDetail',
          value: { agentId: 'agent-new' },
        });

        const patched = result['T-3'].subtasks?.[1].children?.[0];
        expect(patched?.assignee).toEqual({
          avatar: null,
          backgroundColor: null,
          id: 'agent-new',
          title: null,
        });
      });

      it('should clear subtask assignee when agentId is null', () => {
        const state: Record<string, TaskDetailData> = { 'T-3': buildParentWithSubtasks() };
        const result = taskDetailReducer(state, {
          id: 'T-3.1',
          type: 'updateTaskDetail',
          value: { agentId: null },
        });

        const patched = result['T-3'].subtasks?.[0];
        expect(patched?.assignee).toBeNull();
      });

      it('should patch name and priority alongside agentId', () => {
        const state: Record<string, TaskDetailData> = { 'T-3': buildParentWithSubtasks() };
        const result = taskDetailReducer(state, {
          id: 'T-3.1',
          type: 'updateTaskDetail',
          value: { agentId: 'agent-new', name: 'Renamed', priority: 5 },
        });

        const patched = result['T-3'].subtasks?.[0];
        expect(patched?.name).toBe('Renamed');
        expect(patched?.priority).toBe(5);
        expect(patched?.assignee?.id).toBe('agent-new');
      });
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

  describe('findSubtaskParentId', () => {
    const buildParent = (): TaskDetailData => ({
      identifier: 'T-parent',
      instruction: 'Parent',
      name: 'Parent',
      status: 'backlog',
      subtasks: [
        { assignee: null, identifier: 'T-sub-1', name: 'Sub 1', status: 'backlog' },
        {
          children: [
            { assignee: null, identifier: 'T-sub-2-1', name: 'Nested', status: 'backlog' },
          ],
          identifier: 'T-sub-2',
          name: 'Sub 2',
          status: 'backlog',
        },
      ],
    });

    it('should return the parent id when the target lives directly in its subtasks', () => {
      const map = { 'T-parent': buildParent() };
      expect(findSubtaskParentId(map, 'T-sub-1')).toBe('T-parent');
    });

    it('should return the parent id when the target is nested deeper in children', () => {
      const map = { 'T-parent': buildParent() };
      expect(findSubtaskParentId(map, 'T-sub-2-1')).toBe('T-parent');
    });

    it('should return undefined when no entry has the target in its subtree', () => {
      const map = { 'T-parent': buildParent() };
      expect(findSubtaskParentId(map, 'T-unknown')).toBeUndefined();
    });

    it('should skip the entry whose key matches the id (self) and return the real parent', () => {
      const map: Record<string, TaskDetailData> = {
        'T-parent': buildParent(),
        // The subtask is also cached under its own key (e.g. user opened it as a detail page).
        'T-sub-1': {
          identifier: 'T-sub-1',
          instruction: 'Sub',
          name: 'Sub 1',
          status: 'backlog',
        },
      };
      expect(findSubtaskParentId(map, 'T-sub-1')).toBe('T-parent');
    });

    it('should return undefined for an empty map', () => {
      expect(findSubtaskParentId({}, 'T-1')).toBeUndefined();
    });
  });
});
