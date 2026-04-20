import type { TaskDetailData } from '@lobechat/types';

import { taskService } from '@/services/task';
import type { StoreSetter } from '@/store/types';

import type { TaskStore } from '../../store';

type Setter = StoreSetter<TaskStore>;

export const createTaskLifecycleSlice = (set: Setter, get: () => TaskStore, _api?: unknown) =>
  new TaskLifecycleSliceActionImpl(set, get, _api);

export class TaskLifecycleSliceActionImpl {
  readonly #get: () => TaskStore;

  constructor(set: Setter, get: () => TaskStore, _api?: unknown) {
    void _api;
    void set;
    this.#get = get;
  }

  cancelTask = async (id: string): Promise<void> => {
    await this.#transitionStatus(id, 'canceled');
  };

  cancelTopic = async (topicId: string): Promise<void> => {
    await taskService.cancelTopic(topicId);
    const { activeTaskId, internal_refreshTaskDetail } = this.#get();
    if (activeTaskId) await internal_refreshTaskDetail(activeTaskId);
  };

  completeTask = async (id: string): Promise<void> => {
    await this.#transitionStatus(id, 'completed');
  };

  deleteTopic = async (topicId: string): Promise<void> => {
    await taskService.deleteTopic(topicId);
    const { activeTaskId, internal_refreshTaskDetail } = this.#get();
    if (activeTaskId) await internal_refreshTaskDetail(activeTaskId);
  };

  pauseTask = async (id: string): Promise<void> => {
    await this.#transitionStatus(id, 'paused');
  };

  resumeTask = async (id: string): Promise<void> => {
    await this.#transitionStatus(id, 'backlog');
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

  // ── Private helper ──

  #transitionStatus = async (
    id: string,
    status: Parameters<typeof taskService.updateStatus>[1],
    extraUpdate?: Partial<TaskDetailData>,
  ): Promise<void> => {
    this.#get().internal_dispatchTaskDetail({
      id,
      type: 'updateTaskDetail',
      value: { status, ...extraUpdate },
    });

    try {
      await taskService.updateStatus(id, status);
      await this.#get().internal_refreshTaskDetail(id);
      await this.#get().refreshTaskList();
    } catch (error) {
      console.error(`[TaskStore] Failed to transition task to ${status}:`, error);
      await this.#get().internal_refreshTaskDetail(id);
    }
  };
}

export type TaskLifecycleSliceAction = Pick<
  TaskLifecycleSliceActionImpl,
  keyof TaskLifecycleSliceActionImpl
>;
