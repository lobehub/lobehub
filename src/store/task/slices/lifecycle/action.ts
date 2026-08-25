import type { TaskDetailData, TaskStatus } from '@lobechat/types';
import debug from 'debug';

import { taskService } from '@/services/task';
import type { StoreSetter } from '@/store/types';
import { runMutation } from '@/store/utils/runMutation';
import { saveToast } from '@/store/utils/saveToast';

import type { TaskStore } from '../../store';

const log = debug('lobe-store:task-lifecycle');

type Setter = StoreSetter<TaskStore>;

const taskGroupKeyByStatus: Record<TaskStatus, string> = {
  backlog: 'backlog',
  canceled: 'canceled',
  completed: 'done',
  failed: 'needsInput',
  paused: 'needsInput',
  running: 'running',
  scheduled: 'running',
};

const isTaskStatus = (status: string | undefined): status is TaskStatus =>
  status !== undefined && status in taskGroupKeyByStatus;

export const createTaskLifecycleSlice = (set: Setter, get: () => TaskStore, _api?: unknown) =>
  new TaskLifecycleSliceActionImpl(set, get, _api);

export class TaskLifecycleSliceActionImpl {
  readonly #get: () => TaskStore;
  #nextStatusTransitionVersion = 0;
  readonly #set: Setter;
  readonly #statusTransitionVersions = new Map<string, number>();

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
    const transitionVersion = ++this.#nextStatusTransitionVersion;
    this.#statusTransitionVersions.set(id, transitionVersion);

    const previousStatusCandidate =
      this.#get().taskDetailMap[id]?.status ??
      this.#get().tasks.find((task) => task.identifier === id)?.status ??
      this.#get()
        .taskGroups.flatMap((group) => group.tasks)
        .find((task) => task.identifier === id)?.status;
    const previousStatus = isTaskStatus(previousStatusCandidate)
      ? previousStatusCandidate
      : undefined;

    this.#get().internal_dispatchTaskDetail({
      id,
      type: 'updateTaskDetail',
      value: { status, ...extraUpdate },
    });
    this.#patchTaskCollectionsStatus(id, status);

    try {
      await runMutation(this.#set, this.#get, {
        mutate: async () => {
          await taskService.updateStatus(id, status, error);
        },
        name: 'transitionStatus',
        onError: async (err) => {
          console.error(`[TaskStore] Failed to transition task to ${status}:`, err);
          if (this.#statusTransitionVersions.get(id) !== transitionVersion) return;

          if (previousStatus) this.#patchTaskCollectionsStatus(id, previousStatus);
          try {
            await this.#get().internal_refreshTaskDetail(id);
          } catch (refreshError) {
            console.error(
              `[TaskStore] Failed to refresh task ${id} after status failure:`,
              refreshError,
            );
          }
          saveToast(err, {
            retry: () => void this.#transitionStatus(id, status, extraUpdate, error),
          });
        },
        setStatus: (s) => {
          if (this.#statusTransitionVersions.get(id) === transitionVersion) {
            this.#get().internal_setTaskSaveStatus(id, s);
          }
        },
      });

      if (this.#statusTransitionVersions.get(id) !== transitionVersion) return;

      const refreshResults = await Promise.allSettled([
        this.#get().internal_refreshTaskDetail(id),
        this.#get().refreshTaskList(),
      ]);
      for (const refreshResult of refreshResults) {
        if (refreshResult.status === 'rejected') {
          log(
            'Failed to refresh task %s after successful status update: %O',
            id,
            refreshResult.reason,
          );
        }
      }
    } finally {
      if (this.#statusTransitionVersions.get(id) === transitionVersion) {
        this.#statusTransitionVersions.delete(id);
      }
    }
  };

  #patchTaskCollectionsStatus = (id: string, status: TaskStatus): void => {
    const { listGroupBy, taskGroups, tasks } = this.#get();
    const listTask = tasks.find((task) => task.identifier === id);
    const groupedTask = taskGroups
      .flatMap((group) => group.tasks)
      .find((task) => task.identifier === id);
    if (!listTask && !groupedTask) return;

    const nextTasks = listTask
      ? tasks.map((item) => (item.identifier === id ? { ...item, status } : item))
      : tasks;
    const nextTaskGroups = groupedTask
      ? listGroupBy === 'status'
        ? taskGroups.map((group) => {
            const targetGroupKey = taskGroupKeyByStatus[status];
            const containsTask = group.tasks.some((item) => item.identifier === id);
            const belongsToTarget = group.key === targetGroupKey;
            const filteredTasks = group.tasks.filter((item) => item.identifier !== id);
            const patchedGroupedTask = { ...groupedTask, status };

            return {
              ...group,
              tasks: belongsToTarget ? [...filteredTasks, patchedGroupedTask] : filteredTasks,
              total: group.total - (containsTask ? 1 : 0) + (belongsToTarget ? 1 : 0),
            };
          })
        : taskGroups.map((group) => ({
            ...group,
            tasks: group.tasks.map((item) => (item.identifier === id ? { ...item, status } : item)),
          }))
      : taskGroups;

    this.#set(
      { taskGroups: nextTaskGroups, tasks: nextTasks },
      false,
      'transitionStatus/patchTaskCollections',
    );
  };
}

export type TaskLifecycleSliceAction = Pick<
  TaskLifecycleSliceActionImpl,
  keyof TaskLifecycleSliceActionImpl
>;
