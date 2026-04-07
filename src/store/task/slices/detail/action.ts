import type { TaskDetailData } from '@lobechat/types';
import isEqual from 'fast-deep-equal';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { taskService } from '@/services/task';
import type { StoreSetter } from '@/store/types';

import type { TaskStore } from '../../store';
import type { TaskDetailDispatch } from './reducer';
import { taskDetailReducer } from './reducer';

// config / heartbeatInterval / heartbeatTimeout are not exposed here:
// - model/provider goes through configSlice.updateTaskModelConfig
// - checkpoint goes through configSlice.updateCheckpoint
// - review goes through configSlice.updateReview
// - heartbeat config will get a dedicated action once the upstream infra in LOBE-6587 is complete
export interface TaskUpdatePayload {
  assigneeAgentId?: string | null;
  description?: string;
  instruction?: string;
  name?: string;
  priority?: number;
}

const FETCH_TASK_DETAIL_KEY = 'fetchTaskDetail';

type Setter = StoreSetter<TaskStore>;

export const createTaskDetailSlice = (set: Setter, get: () => TaskStore, _api?: unknown) =>
  new TaskDetailSliceActionImpl(set, get, _api);

export class TaskDetailSliceActionImpl {
  readonly #get: () => TaskStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => TaskStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  // ── Public Actions ──

  addComment = async (
    taskId: string,
    content: string,
    opts?: { briefId?: string; topicId?: string },
  ): Promise<void> => {
    await taskService.addComment(taskId, content, opts);
    await this.internal_refreshTaskDetail(taskId);
  };

  addDependency = async (
    taskId: string,
    dependsOnId: string,
    type?: 'blocks' | 'relates',
  ): Promise<void> => {
    await taskService.addDependency(taskId, dependsOnId, type);
    await this.internal_refreshTaskDetail(taskId);
  };

  createTask = async (params: {
    assigneeAgentId?: string;
    description?: string;
    instruction: string;
    name?: string;
    parentTaskId?: string;
    priority?: number;
  }): Promise<string | null> => {
    this.#set({ isCreatingTask: true }, false, 'createTask/start');
    try {
      const result = await taskService.create(params);
      await this.#get().refreshTaskList();
      return result.data?.identifier ?? null;
    } catch (error) {
      console.error('[TaskStore] Failed to create task:', error);
      return null;
    } finally {
      this.#set({ isCreatingTask: false }, false, 'createTask/end');
    }
  };

  deleteTask = async (id: string): Promise<void> => {
    this.#set({ isDeletingTask: true }, false, 'deleteTask/start');
    try {
      this.internal_dispatchTaskDetail({ id, type: 'deleteTaskDetail' });

      await taskService.delete(id);

      if (this.#get().activeTaskId === id) {
        this.#set({ activeTaskId: undefined }, false, 'deleteTask/clearActive');
      }

      await this.#get().refreshTaskList();
    } catch (error) {
      console.error('[TaskStore] Failed to delete task:', error);
      await this.internal_refreshTaskDetail(id);
    } finally {
      this.#set({ isDeletingTask: false }, false, 'deleteTask/end');
    }
  };

  pinDocument = async (taskId: string, documentId: string): Promise<void> => {
    await taskService.pinDocument(taskId, documentId);
    await this.internal_refreshTaskDetail(taskId);
  };

  removeDependency = async (taskId: string, dependsOnId: string): Promise<void> => {
    await taskService.removeDependency(taskId, dependsOnId);
    await this.internal_refreshTaskDetail(taskId);
  };

  reorderSubtasks = async (taskId: string, order: string[]): Promise<void> => {
    await taskService.reorderSubtasks(taskId, order);
    await this.internal_refreshTaskDetail(taskId);
  };

  setActiveTaskId = (taskId?: string): void => {
    if (this.#get().activeTaskId === taskId) return;
    this.#set({ activeTaskId: taskId }, false, 'setActiveTaskId');
  };

  unpinDocument = async (taskId: string, documentId: string): Promise<void> => {
    await taskService.unpinDocument(taskId, documentId);
    await this.internal_refreshTaskDetail(taskId);
  };

  updateTask = async (id: string, data: TaskUpdatePayload): Promise<void> => {
    // Optimistic update — all fields in TaskUpdatePayload directly map to TaskDetailData
    this.internal_dispatchTaskDetail({ id, type: 'updateTaskDetail', value: data });
    this.#set({ taskSaveStatus: 'saving' }, false, 'updateTask/saving');

    try {
      await taskService.update(id, data);
      this.#set({ taskSaveStatus: 'saved' }, false, 'updateTask/saved');
    } catch (error) {
      console.error('[TaskStore] Failed to update task:', error);
      this.#set({ taskSaveStatus: 'idle' }, false, 'updateTask/error');
      // Revert by refreshing from server
      await this.internal_refreshTaskDetail(id);
    }
  };

  useFetchTaskDetail = (taskId?: string) => {
    return useClientDataSWR(
      taskId ? [FETCH_TASK_DETAIL_KEY, taskId] : null,
      async ([, id]: [string, string]) => {
        const result = await taskService.getDetail(id);
        return result.data;
      },
      {
        onSuccess: (data: TaskDetailData) => {
          if (data && taskId) {
            this.internal_dispatchTaskDetail({
              id: taskId,
              type: 'setTaskDetail',
              value: data,
            });
          }
        },
      },
    );
  };

  // ── Internal Actions ──

  internal_dispatchTaskDetail = (payload: TaskDetailDispatch): void => {
    const currentMap = this.#get().taskDetailMap;
    const nextMap = taskDetailReducer(currentMap, payload);

    if (isEqual(nextMap, currentMap)) return;

    this.#set({ taskDetailMap: nextMap }, false, `internal_dispatchTaskDetail/${payload.type}`);
  };

  internal_refreshTaskDetail = async (id: string): Promise<void> => {
    await mutate([FETCH_TASK_DETAIL_KEY, id]);
  };
}

export type TaskDetailSliceAction = Pick<
  TaskDetailSliceActionImpl,
  keyof TaskDetailSliceActionImpl
>;
