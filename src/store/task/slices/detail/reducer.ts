import type { TaskDetailData, TaskDetailSubtask } from '@lobechat/types';
import { produce } from 'immer';

export type TaskDetailDispatch =
  | { id: string; type: 'deleteTaskDetail' }
  | { id: string; type: 'setTaskDetail'; value: TaskDetailData }
  | { id: string; type: 'updateTaskDetail'; value: Partial<TaskDetailData> };

const containsSubtaskInTree = (subtasks: TaskDetailSubtask[], id: string): boolean => {
  for (const subtask of subtasks) {
    if (subtask.identifier === id) return true;
    if (subtask.children && containsSubtaskInTree(subtask.children, id)) return true;
  }
  return false;
};

// Mirrors the walk in `updateTaskDetail` so callers can pre-compute which
// parent entry an upcoming dispatch will mutate (e.g. for optimistic rollback).
export const findSubtaskParentId = (
  map: Record<string, TaskDetailData>,
  id: string,
): string | undefined => {
  for (const parentId in map) {
    if (parentId === id) continue;
    const subtasks = map[parentId]?.subtasks;
    if (subtasks && containsSubtaskInTree(subtasks, id)) return parentId;
  }
  return undefined;
};

// Walk the subtask tree (subtasks live nested under a parent task's detail)
// and patch the entry whose identifier matches. Returns true if patched.
const patchSubtaskInTree = (
  subtasks: TaskDetailSubtask[],
  id: string,
  value: Partial<TaskDetailData>,
): boolean => {
  for (const subtask of subtasks) {
    if (subtask.identifier === id) {
      if (value.name !== undefined) subtask.name = value.name;
      if (value.priority !== undefined) subtask.priority = value.priority;
      if (value.agentId !== undefined) {
        // null = unassigned (clear it). For a real agentId, only patching assignee.id
        // is enough — AssigneeAvatar resolves title/avatar/backgroundColor reactively
        // from the agent store via useAgentDisplayMeta(agentId).
        if (value.agentId === null) {
          subtask.assignee = null;
        } else {
          subtask.assignee = subtask.assignee
            ? { ...subtask.assignee, id: value.agentId }
            : { avatar: null, backgroundColor: null, id: value.agentId, title: null };
        }
      }
      return true;
    }
    if (subtask.children && patchSubtaskInTree(subtask.children, id, value)) {
      return true;
    }
  }
  return false;
};

export const taskDetailReducer = (
  state: Record<string, TaskDetailData>,
  payload: TaskDetailDispatch,
): Record<string, TaskDetailData> => {
  switch (payload.type) {
    case 'setTaskDetail': {
      return produce(state, (draft) => {
        draft[payload.id] = payload.value;
      });
    }

    case 'updateTaskDetail': {
      return produce(state, (draft) => {
        if (draft[payload.id]) {
          Object.assign(draft[payload.id], payload.value);
        }
        for (const parentId in draft) {
          const subtasks = draft[parentId]?.subtasks;
          if (subtasks && patchSubtaskInTree(subtasks, payload.id, payload.value)) break;
        }
      });
    }

    case 'deleteTaskDetail': {
      return produce(state, (draft) => {
        delete draft[payload.id];
      });
    }

    default: {
      return state;
    }
  }
};
