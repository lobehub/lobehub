import type { TaskDetailData } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { t } from 'i18next';

import { message } from '@/components/AntdStaticMethods';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { taskService } from '@/services/task';
import type { StoreSetter } from '@/store/types';

import type { TaskStore } from '../../store';
import { useTaskStore } from '../../store';
import type { TaskDetailDispatch } from './reducer';
import { taskDetailReducer } from './reducer';

type CreatedTask = NonNullable<Awaited<ReturnType<typeof taskService.create>>['data']>;
type DeletedTask = NonNullable<Awaited<ReturnType<typeof taskService.delete>>['data']>;

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
const TASK_DETAIL_POLL_INTERVAL = 10_000;

// Poll while the task itself or any topic activity is still in flight, so the
// UI picks up status transitions (running → completed/failed) without needing
// a manual refresh. Returns false once everything settles so SWR stops polling.
const hasInFlightActivity = (detail: TaskDetailData | undefined): boolean => {
  if (!detail) return false;
  if (detail.status === 'running' || detail.status === 'pending') return true;
  return (
    detail.activities?.some(
      (a) => a.type === 'topic' && (a.status === 'running' || a.status === 'pending'),
    ) ?? false
  );
};

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

  deleteComment = async (commentId: string, taskId?: string): Promise<void> => {
    await taskService.deleteComment(commentId);
    const id = taskId ?? this.#get().activeTaskId;
    if (id) await this.internal_refreshTaskDetail(id);
  };

  updateComment = async (commentId: string, content: string, taskId?: string): Promise<void> => {
    await taskService.updateComment(commentId, content);
    const id = taskId ?? this.#get().activeTaskId;
    if (id) await this.internal_refreshTaskDetail(id);
  };

  addDependency = async (
    taskId: string,
    dependsOnId: string,
    type?: 'blocks' | 'relates',
  ): Promise<void> => {
    await taskService.addDependency(taskId, dependsOnId, type);
    await this.internal_refreshTaskDetail(taskId);
  };

  fetchTaskDetail = async (taskId?: string): Promise<TaskDetailData> => {
    const resolvedId = taskId ?? this.#get().activeTaskId;

    if (!resolvedId) {
      throw new Error('No task identifier provided and no current task context.');
    }

    const result = await taskService.getDetail(resolvedId);
    const detail = result.data;

    if (!detail) {
      throw new Error(`Task not found: ${resolvedId}`);
    }

    this.internal_dispatchTaskDetail({
      id: detail.identifier,
      type: 'setTaskDetail',
      value: detail,
    });

    // When looked up by raw DB id (e.g. `task_xxx`), also store under that key
    // so `activeTaskId` → `taskDetailMap[activeTaskId]` resolves correctly.
    if (resolvedId !== detail.identifier) {
      this.internal_dispatchTaskDetail({
        id: resolvedId,
        type: 'setTaskDetail',
        value: detail,
      });
    }

    return detail;
  };

  createTask = async (params: {
    assigneeAgentId?: string;
    createdByAgentId?: string;
    description?: string;
    instruction: string;
    name?: string;
    parentTaskId?: string;
    priority?: number;
  }): Promise<CreatedTask | null> => {
    this.#set({ isCreatingTask: true }, false, 'createTask/start');
    try {
      const result = await taskService.create(params);
      await this.#get().refreshTaskList();
      if (params.parentTaskId) {
        await this.internal_refreshTaskDetail(params.parentTaskId);
      }
      return result.data ?? null;
    } finally {
      this.#set({ isCreatingTask: false }, false, 'createTask/end');
    }
  };

  deleteTask = async (identifier: string): Promise<DeletedTask | null> => {
    const snapshot = this.#get().taskDetailMap[identifier];
    this.#set({ isDeletingTask: true }, false, 'deleteTask/start');
    try {
      this.internal_dispatchTaskDetail({ id: identifier, type: 'deleteTaskDetail' });

      const result = await taskService.delete(identifier);

      if (this.#get().activeTaskId === identifier) {
        this.#set({ activeTaskId: undefined }, false, 'deleteTask/clearActive');
      }

      await this.#get().refreshTaskList();
      return result.data ?? null;
    } catch (error) {
      if (snapshot) {
        this.internal_dispatchTaskDetail({
          id: identifier,
          type: 'setTaskDetail',
          value: snapshot,
        });
      }
      throw error;
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
    this.#set(
      { activeTaskId: taskId, activeTopicDrawerTopicId: undefined },
      false,
      'setActiveTaskId',
    );
  };

  openTopicDrawer = (topicId: string): void => {
    if (this.#get().activeTopicDrawerTopicId === topicId) return;
    this.#set({ activeTopicDrawerTopicId: topicId }, false, 'openTopicDrawer');
  };

  closeTopicDrawer = (): void => {
    if (!this.#get().activeTopicDrawerTopicId) return;
    this.#set({ activeTopicDrawerTopicId: undefined }, false, 'closeTopicDrawer');
  };

  unpinDocument = async (taskId: string, documentId: string): Promise<void> => {
    await taskService.unpinDocument(taskId, documentId);
    await this.internal_refreshTaskDetail(taskId);
  };

  updateTask = async (id: string, data: TaskUpdatePayload): Promise<void> => {
    const { assigneeAgentId, ...rest } = data;
    const optimistic: Partial<TaskDetailData> = {
      ...rest,
      ...(assigneeAgentId !== undefined ? { agentId: assigneeAgentId } : {}),
    };
    this.internal_dispatchTaskDetail({ id, type: 'updateTaskDetail', value: optimistic });
    this.#set({ taskSaveStatus: 'saving' }, false, 'updateTask/saving');

    try {
      await taskService.update(id, data);
      this.#set({ taskSaveStatus: 'saved' }, false, 'updateTask/saved');
      if (assigneeAgentId !== undefined) {
        await this.#get().refreshTaskList();
      }
    } catch (error) {
      this.#set({ taskSaveStatus: 'idle' }, false, 'updateTask/error');
      // Revert by refreshing from server
      await this.internal_refreshTaskDetail(id);
      message.error(
        t('taskDetail.updateFailed', {
          defaultValue: 'Failed to update task',
          ns: 'chat',
        }),
      );
      throw error;
    }
  };

  useFetchTaskDetail = (taskId?: string) => {
    // Drive polling from a reactive boolean. SWR's function-form refreshInterval
    // is a trap here: it's only re-evaluated after a timer fires, so if the first
    // call (with undefined cache data) returns 0, no timer is ever scheduled and
    // polling never starts — even once real data arrives.
    const shouldPoll = useTaskStore((s) => {
      const detail = taskId ? s.taskDetailMap[taskId] : undefined;
      return hasInFlightActivity(detail);
    });

    return useClientDataSWR(
      taskId ? [FETCH_TASK_DETAIL_KEY, taskId] : null,
      async ([, id]: [string, string]) => this.fetchTaskDetail(id),
      { refreshInterval: shouldPoll ? TASK_DETAIL_POLL_INTERVAL : 0 },
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
