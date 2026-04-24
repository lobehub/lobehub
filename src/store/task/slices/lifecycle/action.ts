import type { TaskDetailData, TaskStatus } from '@lobechat/types';

import { taskService } from '@/services/task';
import type { StoreSetter } from '@/store/types';

import type { TaskStore } from '../../store';

type Setter = StoreSetter<TaskStore>;

export const createTaskLifecycleSlice = (set: Setter, get: () => TaskStore, _api?: unknown) =>
  new TaskLifecycleSliceActionImpl(set, get, _api);

export class TaskLifecycleSliceActionImpl {
  readonly #get: () => TaskStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => TaskStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  cancelTopic = async (topicId: string): Promise<void> => {
    await taskService.cancelTopic(topicId);
    const { activeTaskId, internal_refreshTaskDetail } = this.#get();
    if (activeTaskId) await internal_refreshTaskDetail(activeTaskId);
  };

  deleteTopic = async (topicId: string): Promise<void> => {
    await taskService.deleteTopic(topicId);
    const { activeTaskId, internal_refreshTaskDetail } = this.#get();
    if (activeTaskId) await internal_refreshTaskDetail(activeTaskId);
  };

  runTask = async (
    id: string,
    params?: { continueTopicId?: string; prompt?: string },
  ): Promise<void> => {
    this.#get().internal_dispatchTaskDetail({
      id,
      type: 'updateTaskDetail',
      value: { error: null, status: 'running' },
    });

    try {
      await taskService.run(id, params);
      await this.#get().internal_refreshTaskDetail(id);
      await this.#get().refreshTaskList();
    } catch (error) {
      console.error('[TaskStore] Failed to run task:', error);
      await this.#get().internal_refreshTaskDetail(id);
    }
  };

  updateTaskStatus = async (
    id: string | undefined,
    status: TaskStatus,
    options?: { error?: string },
  ): Promise<string> => {
    const { error } = options ?? {};
    const resolvedId = id ?? this.#get().activeTaskId;

    if (!resolvedId) {
      throw new Error('No task identifier provided and no current task context.');
    }

    const extraUpdate: Partial<TaskDetailData> = { status };
    if (status === 'failed' && error) {
      extraUpdate.error = error;
    }

    await this.#transitionStatus(resolvedId, status, extraUpdate, error);

    return resolvedId;
  };

  // ── Private helper ──

  #transitionStatus = async (
    id: string,
    status: TaskStatus,
    extraUpdate?: Partial<TaskDetailData>,
    error?: string,
  ): Promise<void> => {
    this.#get().internal_dispatchTaskDetail({
      id,
      type: 'updateTaskDetail',
      value: { status, ...extraUpdate },
    });
    this.#set({ taskSaveStatus: 'saving' }, false, 'transitionStatus/saving');

    try {
      await taskService.updateStatus(id, status, error);
      this.#set({ taskSaveStatus: 'saved' }, false, 'transitionStatus/saved');
      await this.#get().internal_refreshTaskDetail(id);
      await this.#get().refreshTaskList();
    } catch (error) {
      console.error(`[TaskStore] Failed to transition task to ${status}:`, error);
      this.#set({ taskSaveStatus: 'idle' }, false, 'transitionStatus/error');
      await this.#get().internal_refreshTaskDetail(id);
      throw error;
    }
  };
}

export type TaskLifecycleSliceAction = Pick<
  TaskLifecycleSliceActionImpl,
  keyof TaskLifecycleSliceActionImpl
>;
