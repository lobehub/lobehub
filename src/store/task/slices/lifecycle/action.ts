import type { TaskDetailData, TaskStatus } from '@lobechat/types';
import debug from 'debug';

import { taskService } from '@/services/task';
import type { StoreSetter } from '@/store/types';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import { runMutation } from '@/store/utils/runMutation';
import { saveToast } from '@/store/utils/saveToast';

import type { TaskStore } from '../../store';
import {
  appendOptimisticPropertyActivity,
  buildOptimisticPropertyActivity,
} from '../detail/optimisticActivity';

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
    options?: { actorAgentId?: string; error?: string },
  ): Promise<string> => {
    const { actorAgentId, error } = options ?? {};
    const resolvedId = id ?? this.#get().activeTaskId;

    if (!resolvedId) {
      throw new Error('No task identifier provided and no current task context.');
    }

    const extraUpdate: Partial<TaskDetailData> = { status };
    if (status === 'failed' && error) {
      extraUpdate.error = error;
    }

    await this.#transitionStatus(resolvedId, status, extraUpdate, error, actorAgentId);

    return resolvedId;
  };

  // ── Private helper ──

  #transitionStatus = async (
    id: string,
    status: TaskStatus,
    extraUpdate?: Partial<TaskDetailData>,
    error?: string,
    /** The agent changing it in the client-first runtime; see TaskUpdateOptions. */
    actorAgentId?: string,
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

    // The feed row rides the same dispatch as the status chip. The refetch
    // after the mutation replaces the whole activity array (retiring this
    // synthesized row), and the failure path already refetches as its rollback.
    const detail = this.#get().taskDetailMap[id];
    const userState = useUserStore.getState();
    const actorId = actorAgentId ? undefined : userProfileSelectors.userId(userState);
    const statusRow =
      detail && previousStatus !== status
        ? buildOptimisticPropertyActivity({
            actor: actorId
              ? {
                  avatar: userProfileSelectors.userAvatar(userState) || null,
                  id: actorId,
                  name: userProfileSelectors.displayUserName(userState) || null,
                  type: 'user',
                }
              : undefined,
            change: { field: 'status', from: previousStatus ?? null, to: status },
            now: new Date().toISOString(),
          })
        : undefined;
    this.#get().internal_dispatchTaskDetail({
      id,
      type: 'updateTaskDetail',
      value: {
        status,
        ...extraUpdate,
        ...(statusRow
          ? { activities: appendOptimisticPropertyActivity(detail?.activities ?? [], statusRow) }
          : {}),
      },
    });
    this.#patchTaskCollectionsStatus(id, status);

    try {
      await runMutation(this.#set, this.#get, {
        mutate: async () => {
          if (actorAgentId) await taskService.updateStatus(id, status, error, { actorAgentId });
          else await taskService.updateStatus(id, status, error);
        },
        name: 'transitionStatus',
        onError: async (err) => {
          console.error(`[TaskStore] Failed to transition task to ${status}:`, err);
          if (this.#statusTransitionVersions.get(id) !== transitionVersion) return;

          if (previousStatus) this.#patchTaskCollectionsStatus(id, previousStatus);
          // The transition did not happen, so its row must go even when the
          // server-truth refetch below cannot run (offline).
          if (statusRow) {
            const latest = this.#get().taskDetailMap[id];
            this.#get().internal_dispatchTaskDetail({
              id,
              type: 'updateTaskDetail',
              value: {
                activities: (latest?.activities ?? []).filter((a) => a.id !== statusRow.id),
              },
            });
          }
          try {
            await this.#get().internal_refreshTaskDetail(id);
          } catch (refreshError) {
            console.error(
              `[TaskStore] Failed to refresh task ${id} after status failure:`,
              refreshError,
            );
          }
          saveToast(err, {
            retry: () => void this.#transitionStatus(id, status, extraUpdate, error, actorAgentId),
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
