import type { TaskDetailData, TaskDetailSubtask } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { t } from 'i18next';

import { message } from '@/components/AntdStaticMethods';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { taskKeys } from '@/libs/swr/keys';
import { taskService } from '@/services/task';
import type { StoreSetter } from '@/store/types';
import { runMutation } from '@/store/utils/runMutation';
import { saveToast } from '@/store/utils/saveToast';
import type { SaveStatus } from '@/types/saveState';

import type { TaskStore } from '../../store';
import { useTaskStore } from '../../store';
import type { TaskDetailDispatch } from './reducer';
import { findSubtaskParentId, taskDetailReducer } from './reducer';

type CreatedTask = NonNullable<Awaited<ReturnType<typeof taskService.create>>['data']>;
type DeletedTask = NonNullable<Awaited<ReturnType<typeof taskService.delete>>['data']>;

// config / heartbeatInterval / heartbeatTimeout are not exposed here:
// - model/provider goes through configSlice.updateTaskModelConfig
// - checkpoint goes through configSlice.updateCheckpoint
// - review goes through configSlice.updateReview
// - heartbeat config will get a dedicated action once the upstream task scheduler infra is complete
export interface TaskUpdatePayload {
  assigneeAgentId?: string | null;
  description?: string;
  editorData?: unknown;
  instruction?: string;
  name?: string;
  parentTaskId?: string | null;
  priority?: number;
}

const TASK_DETAIL_POLL_INTERVAL = 10_000;

const hasInFlightSubtask = (subtasks: TaskDetailSubtask[] | undefined): boolean =>
  subtasks?.some(
    (subtask) =>
      Boolean(subtask.runningTopic) ||
      subtask.status === 'running' ||
      subtask.status === 'pending' ||
      hasInFlightSubtask(subtask.children),
  ) ?? false;

// Poll while the task itself or any topic activity is still in flight, so the
// UI picks up status transitions (running → completed/failed) without needing
// a manual refresh. Returns false once everything settles so SWR stops polling.
const hasInFlightActivity = (detail: TaskDetailData | undefined): boolean => {
  if (!detail) return false;
  if (detail.status === 'running' || detail.status === 'pending') return true;
  if (hasInFlightSubtask(detail.subtasks)) return true;
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
    opts?: {
      authorAgentId?: string;
      briefId?: string;
      editorData?: unknown;
      topicId?: string;
    },
  ): Promise<Awaited<ReturnType<typeof taskService.addComment>>> => {
    const result = await taskService.addComment(taskId, content, opts);
    await this.internal_refreshTaskDetail(taskId);
    return result;
  };

  deleteComment = async (commentId: string, taskId?: string): Promise<void> => {
    await taskService.deleteComment(commentId);
    const id = taskId ?? this.#get().activeTaskId;
    if (id) await this.internal_refreshTaskDetail(id);
  };

  updateComment = async (
    commentId: string,
    content: string,
    opts?: { editorData?: unknown; taskId?: string },
  ): Promise<void> => {
    const { taskId, ...rest } = opts ?? {};
    await taskService.updateComment(commentId, content, rest);
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
      // Mark the *resolved* not-found so the read side can tell it apart from a
      // network / 500 rejection (which propagates from `taskService.getDetail`
      // above with an HTTP status). Without this tag both would render the same
      // terminal 404, telling the user a merely-errored task was deleted.
      const notFound = new Error(`Task not found: ${resolvedId}`) as Error & { code?: string };
      notFound.code = 'TASK_NOT_FOUND';
      throw notFound;
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
    automationMode?: 'heartbeat' | 'schedule';
    createdByAgentId?: string;
    description?: string;
    editorData?: unknown;
    instruction: string;
    name?: string;
    parentTaskId?: string;
    priority?: number;
    schedulePattern?: string;
    scheduleTimezone?: string;
    visibility?: 'private' | 'public';
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
      {
        activeTaskId: taskId,
        activeTopicDrawerTopicId: undefined,
      },
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
    // taskId here is the source (owning) task — may be a descendant of the
    // task currently open. The detail page's SWR cache is keyed by activeTaskId,
    // so revalidate that too; otherwise the artifact stays visible until reload.
    await this.internal_refreshTaskDetail(taskId);
    const activeTaskId = this.#get().activeTaskId;
    if (activeTaskId && activeTaskId !== taskId) {
      await this.internal_refreshTaskDetail(activeTaskId);
    }
  };

  updateTaskVisibility = async (id: string, visibility: 'private' | 'public'): Promise<void> => {
    try {
      await taskService.updateVisibility(id, visibility);
      await Promise.all([this.#get().refreshTaskList(), this.internal_refreshTaskDetail(id)]);
    } catch (error) {
      // Surfaces a specific actionable error when the task's assignee is a
      // private agent. The generic "failed" toast hides what the user must
      // do next; substitute a targeted one so they know to either reassign
      // or publish the agent first.
      const raw = (error as { message?: string })?.message ?? '';
      const isPrivateAgentBlock = /public task cannot be assigned to a private agent/i.test(raw);
      message.error(
        isPrivateAgentBlock
          ? t('taskDetail.publishToWorkspace.errorPrivateAgent', {
              defaultValue:
                'This task is assigned to a private agent. Reassign to a workspace agent, or publish the agent first.',
              ns: 'chat',
            })
          : t('createTask.visibility.changeFailed', {
              defaultValue: 'Failed to change task visibility',
              ns: 'chat',
            }),
      );
      throw error;
    }
  };

  updateTask = async (id: string, data: TaskUpdatePayload): Promise<void> => {
    const { assigneeAgentId, ...rest } = data;
    const optimisticRest = { ...rest };
    delete optimisticRest.parentTaskId;
    const optimistic: Partial<TaskDetailData> = {
      ...optimisticRest,
      ...(assigneeAgentId !== undefined ? { agentId: assigneeAgentId } : {}),
    };

    // Snapshot every map entry the optimistic patch will touch BEFORE dispatch.
    // activeTaskId can change mid-flight, and the patch can mutate a parent's
    // cached subtree in addition to `id`, so rollback must target both.
    const patchedParentId = findSubtaskParentId(this.#get().taskDetailMap, id);
    const snapshotActiveTaskId = this.#get().activeTaskId;
    const refreshPatchedTargets = async (): Promise<void> => {
      const targets = new Set<string>([id]);
      if (patchedParentId) targets.add(patchedParentId);
      if (data.parentTaskId) targets.add(data.parentTaskId);
      if (snapshotActiveTaskId) targets.add(snapshotActiveTaskId);
      await Promise.all(
        Array.from(targets).map((target) => this.internal_refreshTaskDetail(target)),
      );
    };

    this.internal_dispatchTaskDetail({ id, type: 'updateTaskDetail', value: optimistic });

    await runMutation(this.#set, this.#get, {
      mutate: () => taskService.update(id, data),
      name: 'updateTask',
      // Rollback is a server-truth refetch (not a local snapshot), so the
      // optimistic dispatch above is reconciled from the source of record.
      onError: async (error) => {
        await refreshPatchedTargets();
        saveToast(error, { retry: () => void this.#get().updateTask(id, data) });
      },
      setStatus: (status) => this.#get().internal_setTaskSaveStatus(id, status),
    });

    if (assigneeAgentId !== undefined || data.parentTaskId !== undefined) {
      await Promise.all([this.#get().refreshTaskList(), refreshPatchedTargets()]).catch(() => {});
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
      taskId ? taskKeys.detail(taskId) : null,
      async ([, id]: [string, string]) => this.fetchTaskDetail(id),
      { refreshInterval: shouldPoll ? TASK_DETAIL_POLL_INTERVAL : 0 },
    );
  };

  // ── Internal Actions ──

  // Write the save status for a single task id. Keyed per task so a `failed`
  // status stays with its task and never bleeds into another task's header after
  // navigation. Shared by every runMutation-based write across the task slices.
  internal_setTaskSaveStatus = (id: string, status: SaveStatus): void => {
    this.#set(
      { taskSaveStatusMap: { ...this.#get().taskSaveStatusMap, [id]: status } },
      false,
      `setTaskSaveStatus/${status}`,
    );
  };

  internal_dispatchTaskDetail = (payload: TaskDetailDispatch): void => {
    const currentMap = this.#get().taskDetailMap;
    const nextMap = taskDetailReducer(currentMap, payload);

    if (isEqual(nextMap, currentMap)) return;

    this.#set({ taskDetailMap: nextMap }, false, `internal_dispatchTaskDetail/${payload.type}`);
  };

  internal_refreshTaskDetail = async (id: string): Promise<void> => {
    await mutate(taskKeys.detail(id));
  };
}

export type TaskDetailSliceAction = Pick<
  TaskDetailSliceActionImpl,
  keyof TaskDetailSliceActionImpl
>;
