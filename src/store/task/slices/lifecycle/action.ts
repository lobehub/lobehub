import type { TaskDetailData, TaskStatus } from '@lobechat/types';
import debug from 'debug';

import { taskService } from '@/services/task';
import type { StoreSetter } from '@/store/types';
import { runMutation } from '@/store/utils/runMutation';
import { saveToast } from '@/store/utils/saveToast';

import type { TaskStore } from '../../store';

const log = debug('lobe-store:task-lifecycle');

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
    options?: { throwOnError?: boolean },
  ): Promise<Awaited<ReturnType<typeof taskService.run>> | null> => {
    this.#get().internal_dispatchTaskDetail({
      id,
      type: 'updateTaskDetail',
      value: { error: null, status: 'running' },
    });

    let result: Awaited<ReturnType<typeof taskService.run>>;
    try {
      result = await taskService.run(id, params);
    } catch (error) {
      log('Failed to run task %s: %O', id, error);
      try {
        await this.#get().internal_refreshTaskDetail(id);
      } catch (refreshError) {
        log('Failed to refresh task %s after run failure: %O', id, refreshError);
      }
      if (options?.throwOnError) throw error;
      return null;
    }

    // The server-side execution has already succeeded. Cache refreshes are
    // best-effort and must not turn that success into a retryable run failure,
    // because retrying would create a duplicate execution.
    const refreshResults = await Promise.allSettled([
      this.#get().internal_refreshTaskDetail(id),
      this.#get().refreshTaskList(),
    ]);
    for (const refreshResult of refreshResults) {
      if (refreshResult.status === 'rejected') {
        log('Failed to refresh task %s after successful run: %O', id, refreshResult.reason);
      }
    }

    return result;
  };

  runReadySubtasks = async (parentTaskId: string) => {
    const result = await taskService.runReadySubtasks(parentTaskId);
    await this.#get().internal_refreshTaskDetail(parentTaskId);
    await this.#get().refreshTaskList();
    return result;
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
    await runMutation(this.#set, this.#get, {
      mutate: async () => {
        await taskService.updateStatus(id, status, error);
        await this.#get().internal_refreshTaskDetail(id);
        await this.#get().refreshTaskList();
      },
      name: 'transitionStatus',
      onError: async (err) => {
        console.error(`[TaskStore] Failed to transition task to ${status}:`, err);
        await this.#get().internal_refreshTaskDetail(id);
        saveToast(err, {
          retry: () => void this.#transitionStatus(id, status, extraUpdate, error),
        });
      },
      setStatus: (s) => this.#get().internal_setTaskSaveStatus(id, s),
    });
  };
}

export type TaskLifecycleSliceAction = Pick<
  TaskLifecycleSliceActionImpl,
  keyof TaskLifecycleSliceActionImpl
>;
