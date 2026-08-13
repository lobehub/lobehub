import type { TaskDetailData, TaskStatus } from '@lobechat/types';
import debug from 'debug';

import { getCacheScope } from '@/libs/swr/useCacheScope';
import {
  activeProjectionRecord,
  findTaskRecordByIdentity,
  getProjectionStoreState,
  selectTaskDetail,
  selectTaskRow,
} from '@/projection';
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
    const projectionScope = getCacheScope();
    const projectionRecord = findTaskRecordByIdentity(
      getProjectionStoreState().scopes[projectionScope],
      id,
    );
    const previousStatusCandidate =
      selectTaskDetail(projectionRecord)?.status ??
      selectTaskRow(projectionRecord)?.status ??
      activeProjectionRecord(projectionRecord)?.fragments.lifecycle?.data.status;
    const previousStatus = isTaskStatus(previousStatusCandidate)
      ? previousStatusCandidate
      : undefined;

    this.#get().internal_dispatchTaskDetail({
      id,
      type: 'updateTaskDetail',
      value: { error: null, status: 'running' },
    });
    getProjectionStoreState().updateTaskProjectionStatus(projectionScope, id, 'running');

    let result: Awaited<ReturnType<typeof taskService.run>>;
    try {
      result = await taskService.run(id, params);
    } catch (error) {
      log('Failed to run task %s: %O', id, error);
      if (previousStatus) {
        if (getCacheScope() === projectionScope) {
          this.#get().internal_dispatchTaskDetail({
            id,
            type: 'updateTaskDetail',
            value: { status: previousStatus },
          });
        }
        getProjectionStoreState().updateTaskProjectionStatus(projectionScope, id, previousStatus);
      }
      const refreshResults =
        getCacheScope() === projectionScope
          ? await Promise.allSettled([
              this.#get().internal_refreshTaskDetail(id),
              this.#get().refreshTaskList(),
            ])
          : [];
      for (const refreshResult of refreshResults) {
        if (refreshResult.status === 'rejected') {
          log('Failed to refresh task %s after run failure: %O', id, refreshResult.reason);
        }
      }
      if (options?.throwOnError) throw error;
      return null;
    }

    // The server-side execution has already succeeded. Cache refreshes are
    // best-effort and must not turn that success into a retryable run failure,
    // because retrying would create a duplicate execution.
    const refreshResults =
      getCacheScope() === projectionScope
        ? await Promise.allSettled([
            this.#get().internal_refreshTaskDetail(id),
            this.#get().refreshTaskList(),
          ])
        : [];
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
    const projectionScope = getCacheScope();
    const projectionRecord = findTaskRecordByIdentity(
      getProjectionStoreState().scopes[projectionScope],
      id,
    );
    const transitionVersion = ++this.#nextStatusTransitionVersion;
    this.#statusTransitionVersions.set(id, transitionVersion);

    const previousStatusCandidate =
      selectTaskDetail(projectionRecord)?.status ??
      selectTaskRow(projectionRecord)?.status ??
      activeProjectionRecord(projectionRecord)?.fragments.lifecycle?.data.status;
    const previousStatus = isTaskStatus(previousStatusCandidate)
      ? previousStatusCandidate
      : undefined;

    this.#get().internal_dispatchTaskDetail({
      id,
      type: 'updateTaskDetail',
      value: { status, ...extraUpdate },
    });
    getProjectionStoreState().updateTaskProjectionStatus(projectionScope, id, status);

    try {
      await runMutation(this.#set, this.#get, {
        mutate: async () => {
          await taskService.updateStatus(id, status, error);
        },
        name: 'transitionStatus',
        onError: async (err) => {
          console.error(`[TaskStore] Failed to transition task to ${status}:`, err);
          if (this.#statusTransitionVersions.get(id) !== transitionVersion) return;

          if (previousStatus) {
            getProjectionStoreState().updateTaskProjectionStatus(
              projectionScope,
              id,
              previousStatus,
            );
          }
          if (getCacheScope() === projectionScope) {
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
          }
        },
        setStatus: (s) => {
          if (
            this.#statusTransitionVersions.get(id) === transitionVersion &&
            getCacheScope() === projectionScope
          ) {
            this.#get().internal_setTaskSaveStatus(id, s);
          }
        },
      });

      if (this.#statusTransitionVersions.get(id) !== transitionVersion) return;

      const refreshResults =
        getCacheScope() === projectionScope
          ? await Promise.allSettled([
              this.#get().internal_refreshTaskDetail(id),
              this.#get().refreshTaskList(),
            ])
          : [];
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
}

export type TaskLifecycleSliceAction = Pick<
  TaskLifecycleSliceActionImpl,
  keyof TaskLifecycleSliceActionImpl
>;
