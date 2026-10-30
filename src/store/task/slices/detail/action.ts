import type { TaskDetailActivityAuthor, TaskDetailData, TaskDetailSubtask } from '@lobechat/types';
import {
  clearTaskReposSelection,
  readTaskExecutionConfig,
  toTaskExecutionConfigPatch,
} from '@lobechat/types';
import { toast } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { t } from 'i18next';

import { cacheScope, createReplicaSlice, recordLens, revalidateReplica } from '@/libs/replica';
import { subscribeCacheScope } from '@/libs/replica/cacheScopeEvents';
import { useClientDataSWR } from '@/libs/swr';
import { taskService } from '@/services/task';
import { workService } from '@/services/work';
import { goalGraphResource } from '@/store/goal/projection';
import type { StoreSetter } from '@/store/types';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import { runMutation } from '@/store/utils/runMutation';
import { saveToast } from '@/store/utils/saveToast';
import type { SaveStatus } from '@/types/saveState';
import { isTrpcErrorCode } from '@/utils/trpcError';

import type { TaskStore } from '../../store';
import { useTaskStore } from '../../store';
import {
  appendOptimisticPropertyActivity,
  buildOptimisticAssignmentActivities,
  buildOptimisticCommentActivity,
  buildOptimisticPropertyActivity,
} from './optimisticActivity';
import { taskDetailResource } from './projection';
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
  assigneeUserId?: string | null;
  description?: string;
  editorData?: unknown;
  instruction?: string;
  name?: string;
  parentTaskId?: string | null;
  priority?: number;
}

export interface TaskUpdateOptions {
  /**
   * The agent making the change when the task tool runs in the browser
   * (client-first runtime), so the server attributes the activity to it. No
   * row is synthesized in that case — the store cannot name the agent — the
   * refetch shows it.
   */
  actorAgentId?: string;
  /**
   * Display metadata for the assignee being set, so the activity feed can show
   * the row immediately instead of after the detail refetch. Supplied by the
   * picker, which already holds the chosen item — the store deliberately does
   * not resolve members itself (that source is a business-layer hook).
   */
  optimisticAssignee?: TaskDetailActivityAuthor;
  /**
   * Replaces the failure toast's Retry when this update is one step of a larger
   * action (e.g. assign-then-run), so Retry repeats the whole action instead of
   * only this write.
   */
  retry?: () => void;
  /**
   * The mounted editor marks its own autosaves so they do not request an
   * external-content reload. Tool calls and refetches are authoritative by default.
   */
  source?: 'editor' | 'external';
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

const hasInstructionSnapshotChanged = (
  current: TaskDetailData | undefined,
  next: TaskDetailData | undefined,
): boolean => {
  if (!current || !next) return false;

  return current.instruction !== next.instruction || !isEqual(current.editorData, next.editorData);
};

type Setter = StoreSetter<TaskStore>;

const cachedTaskId = (ref: string | undefined, index: Record<string, string>) =>
  ref?.trim().startsWith('task_') ? ref.trim() : ref ? index[ref] : undefined;

export const createTaskDetailSlice = (set: Setter, get: () => TaskStore, _api?: unknown) =>
  new TaskDetailSliceActionImpl(set, get, _api);

export class TaskDetailSliceActionImpl {
  readonly #get: () => TaskStore;
  readonly #set: Setter;
  readonly #detail;
  readonly #reconciliations = new WeakMap<TaskDetailData, Promise<void>>();
  readonly #previous = new WeakMap<TaskDetailData, TaskDetailData | undefined>();

  constructor(set: Setter, get: () => TaskStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
    this.#detail = createReplicaSlice(taskDetailResource, {
      actionPrefix: 'taskDetail',
      // Persist canonical entries through the replica; applied responses also
      // refresh aliases, instruction revisions and completed-run reconciliation.
      fetcher: (id) => this.#loadTaskDetail(id),
      effects: {
        onApplied: (detail, id) => {
          this.#rememberTask({ id: detail.id!, identifier: detail.identifier }, id);
          if (hasInstructionSnapshotChanged(this.#previous.get(detail), detail)) {
            const state = this.#get();
            this.#set(
              {
                taskInstructionRevisionMap: {
                  ...state.taskInstructionRevisionMap,
                  [id]: (state.taskInstructionRevisionMap[id] ?? 0) + 1,
                },
              },
              false,
              'taskDetail/instructionChanged',
            );
          }
          const reconciliation = this.#reconcileRuns(detail);
          this.#reconciliations.set(detail, reconciliation);
          void reconciliation.catch((error) => console.error('[taskDetail:reconcile]', error));
        },
        onError: (error, id) => {
          if ((error as { code?: string })?.code === 'TASK_NOT_FOUND') {
            this.#detail.remove(id);
            this.#forgetTask(id);
          }
        },
      },
      get,
      merge: (incoming, confirmed) => (isEqual(incoming, confirmed) ? undefined : incoming),
      set,
      stateKey: 'taskDetailReplica',
      view: recordLens<TaskStore, TaskDetailData>('taskDetailMap'),
    });
    subscribeCacheScope((scope) => {
      this.#set({ taskRefIndex: {}, activeTaskId: undefined }, false, 'taskDetail/scopeChanged');
      this.#detail.ensureScope(scope);
    });
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
    // Same treatment as the assignee chip: the row appears on send, not after
    // the mutation *and* the detail refetch. A comment posted on an agent's
    // behalf (client-first runtime) is left to the refetch — the store has no
    // agent identity to attribute it to.
    const current = this.#get().taskDetailMap[taskId];
    const userState = useUserStore.getState();
    const actorId = userProfileSelectors.userId(userState);
    const optimistic =
      current && !opts?.authorAgentId
        ? buildOptimisticCommentActivity({
            actor: actorId
              ? {
                  avatar: userProfileSelectors.userAvatar(userState) || null,
                  id: actorId,
                  name: userProfileSelectors.displayUserName(userState) || null,
                  type: 'user',
                }
              : undefined,
            content,
            editorData: opts?.editorData,
            now: new Date().toISOString(),
            topicId: opts?.topicId,
          })
        : undefined;
    if (optimistic) {
      this.internal_dispatchTaskDetail({
        id: taskId,
        type: 'updateTaskDetail',
        value: { activities: [...(current?.activities ?? []), optimistic] },
      });
    }

    let result: Awaited<ReturnType<typeof taskService.addComment>>;
    try {
      result = await taskService.addComment(taskId, content, opts);
    } catch (error) {
      // The send failed, so the row must go even if the network is down and
      // the server-truth refetch below cannot run — otherwise an unsaved
      // comment keeps looking posted until something else refreshes.
      if (optimistic) {
        const latest = this.#get().taskDetailMap[taskId];
        this.internal_dispatchTaskDetail({
          id: taskId,
          type: 'updateTaskDetail',
          value: {
            activities: (latest?.activities ?? []).filter((a) => a.id !== optimistic.id),
          },
        });
        await this.internal_refreshTaskDetail(taskId).catch(() => {});
      }
      throw error;
    }
    // Post-success refresh failing is not the comment failing: it is saved.
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

  #loadTaskDetail = async (taskId: string): Promise<TaskDetailData> => {
    const result = await taskService.getDetail(taskId).catch((error) => {
      if (isTrpcErrorCode(error, 'NOT_FOUND')) {
        const missing = new Error('Task not found') as Error & { code: string };
        missing.code = 'TASK_NOT_FOUND';
        throw missing;
      }
      throw error;
    });
    if (!result.data?.id) {
      const error = new Error('Task not found') as Error & { code: string };
      error.code = 'TASK_NOT_FOUND';
      throw error;
    }
    this.#previous.set(result.data, this.#get().taskDetailMap[taskId]);
    return result.data;
  };

  #reconcileRuns = async (detail: TaskDetailData) => {
    // Reconcile at the server-read boundary, even when the live chat panel has
    // unmounted. A missing running marker alone is not proof of completion.
    const terminalActivities = detail.activities?.filter(
      (activity) =>
        activity.type === 'topic' &&
        activity.id &&
        activity.operationId &&
        ['completed', 'failed', 'canceled', 'timeout'].includes(activity.status ?? '') &&
        activity.runningOperation?.operationId !== activity.operationId,
    );
    if (terminalActivities?.length) {
      const { getChatStoreState } = await import('@/store/chat');
      for (const activity of terminalActivities) {
        getChatStoreState().reconcileServerOperation({
          operationId: activity.operationId!,
          status:
            activity.status === 'completed'
              ? 'completed'
              : activity.status === 'canceled'
                ? 'cancelled'
                : 'failed',
          topicId: activity.id!,
        });
      }
    }
  };

  internal_resolveTaskId = async (ref: string): Promise<string> => {
    const known = cachedTaskId(ref, this.#get().taskRefIndex);
    if (known) return known;
    const scope = cacheScope.get();
    const { data } = await taskService.find(ref);
    if (cacheScope.get() !== scope) throw new Error('Task scope changed while resolving reference');
    this.#rememberTask(data, ref);
    return data.id;
  };

  fetchTaskDetail = async (ref?: string): Promise<TaskDetailData> => {
    ref ??= this.#get().activeTaskId ?? this.#get().activeTaskRef;
    if (!ref) throw new Error('No task identifier provided and no current task context.');
    const id = await this.internal_resolveTaskId(ref);
    const { data, applied } = await this.#detail.fetch(id);
    if (!data || !applied) throw new Error('Task detail request was superseded');
    await this.#reconciliations.get(data);
    return data;
  };

  createTask = async (params: {
    assigneeAgentId?: string;
    assigneeUserId?: string;
    automationMode?: 'heartbeat' | 'schedule';
    config?: Record<string, unknown>;
    createdByAgentId?: string;
    description?: string;
    editorData?: unknown;
    /** Bind a goal entity (`goals` row) to the created task. */
    instruction: string;
    name?: string;
    parentTaskId?: string;
    priority?: number;
    projectId?: string;
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

  deleteTask = async (ref: string): Promise<DeletedTask | null> => {
    const identifier = this.#get().taskRefIndex[ref] ?? ref;
    const snapshot = this.#get().taskDetailMap[identifier];
    this.#set({ isDeletingTask: true }, false, 'deleteTask/start');
    try {
      this.internal_dispatchTaskDetail({ id: identifier, type: 'deleteTaskDetail' });

      const result = await taskService.delete(identifier);
      this.#forgetTask(identifier);

      if (this.#get().activeTaskId === identifier) {
        this.#set({ activeTaskId: undefined }, false, 'deleteTask/clearActive');
      }

      await this.#get().refreshTaskList();
      try {
        // Deleting a task can orphan its Works across topics; the summary chips
        // ride the message payload, so invalidate message lists too, not just
        // the work-domain sidebar caches.
        await workService.refreshAllConversations();
      } catch (error) {
        console.error('[task:deleteTask:refreshWork]', error);
      }
      return result.data ?? null;
    } catch (error) {
      // The optimistic delete also dropped the persisted row; restore the
      // confirmed snapshot through `replace` so it is persisted again.
      if (snapshot) this.#detail.replace(identifier, snapshot);
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
    if (this.#get().activeTaskRef === taskId) return;
    this.#set(
      {
        activeTaskRef: taskId,
        activeTaskId: cachedTaskId(taskId, this.#get().taskRefIndex),
        activeTopicDrawerAgentId: undefined,
        activeTopicDrawerFocusRequest: undefined,
        activeTopicDrawerTitle: undefined,
        activeTopicDrawerTopicId: undefined,
      },
      false,
      'setActiveTaskId',
    );
  };

  /**
   * `topic` carries the agent and title for a run opened outside a task detail
   * (the home inbox lists plain topics too) — the drawer falls back to it when
   * no task detail is loaded to read them from. `autoFocus` marks openings made
   * with conversational intent (the brief's "Continue chat"); each one bumps
   * the focus request so the body expands and focuses its reply composer, even
   * when the drawer already shows this topic.
   */
  openTopicDrawer = (
    topicId: string,
    topic?: { agentId?: string; autoFocus?: boolean; title?: string },
  ): void => {
    const current = this.#get();
    if (current.activeTopicDrawerTopicId === topicId && !topic?.autoFocus) return;
    this.#set(
      {
        activeTopicDrawerAgentId: topic?.agentId,
        activeTopicDrawerFocusRequest: topic?.autoFocus
          ? (current.activeTopicDrawerFocusRequest ?? 0) + 1
          : undefined,
        activeTopicDrawerTitle: topic?.title,
        activeTopicDrawerTopicId: topicId,
      },
      false,
      'openTopicDrawer',
    );
  };

  closeTopicDrawer = (): void => {
    if (!this.#get().activeTopicDrawerTopicId) return;
    this.#set(
      {
        activeTopicDrawerAgentId: undefined,
        activeTopicDrawerFocusRequest: undefined,
        activeTopicDrawerTitle: undefined,
        activeTopicDrawerTopicId: undefined,
      },
      false,
      'closeTopicDrawer',
    );
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
      const isOtherCreatorsBlock = /subtasks created by other members/i.test(raw);
      toast.error(
        isPrivateAgentBlock
          ? t('taskDetail.publishToWorkspace.errorPrivateAgent', {
              defaultValue:
                'This task is assigned to a private agent. Reassign to a workspace agent, or publish the agent first.',
              ns: 'chat',
            })
          : isOtherCreatorsBlock
            ? t('taskDetail.makePrivate.errorOtherCreators', {
                defaultValue:
                  'This task has subtasks created by other members. Move or remove them before making it private.',
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

  updateTask = async (
    id: string,
    data: TaskUpdatePayload,
    options?: TaskUpdateOptions,
  ): Promise<void> => {
    id = this.#get().taskRefIndex[id] ?? id;
    const { assigneeAgentId, assigneeUserId, ...rest } = data;
    const optimisticRest = { ...rest };
    delete optimisticRest.parentTaskId;
    // editTask may send only instruction while the detail store still holds old rich editorData.
    // Mirror the server normalization so the optimistic render cannot prefer stale JSON.
    if (optimisticRest.instruction !== undefined && optimisticRest.editorData === undefined) {
      optimisticRest.editorData = null;
    }
    // The assignee chip flips on this dispatch; the feed row it explains must
    // land in the same beat, not after the mutation *and* the detail refetch.
    const current = this.#get().taskDetailMap[id];
    const userState = useUserStore.getState();
    const actorId = options?.actorAgentId ? undefined : userProfileSelectors.userId(userState);
    const optimisticActivities = current
      ? buildOptimisticAssignmentActivities({
          actor: actorId
            ? {
                avatar: userProfileSelectors.userAvatar(userState) || null,
                id: actorId,
                name: userProfileSelectors.displayUserName(userState) || null,
                type: 'user',
              }
            : undefined,
          assigneeAgentId,
          assigneeUserId,
          current: { agentId: current.agentId, userId: current.userId },
          now: new Date().toISOString(),
          target: options?.optimisticAssignee,
        })
      : [];
    // Priority rides the same dispatch as the assignee rows.
    const priorityRow =
      current && rest.priority !== undefined && rest.priority !== (current.priority ?? null)
        ? buildOptimisticPropertyActivity({
            actor: actorId
              ? {
                  avatar: userProfileSelectors.userAvatar(userState) || null,
                  id: actorId,
                  name: userProfileSelectors.displayUserName(userState) || null,
                  type: 'user',
                }
              : undefined,
            change: { field: 'priority', from: current.priority ?? null, to: rest.priority },
            now: new Date().toISOString(),
          })
        : undefined;
    const activities = appendOptimisticPropertyActivity(
      [...(current?.activities ?? []), ...optimisticActivities],
      priorityRow,
    );
    // Mirror the server's reassign rule (`TaskModel.updateWithLog`) so the
    // run-location cluster stops showing the previous agent's repos the moment
    // the assignee flips, instead of one refetch later: `repos` belong to the
    // assignee's provider env, and the run those repos imply is the sandbox
    // directory the new agent may not be able to open. Same helper as the
    // server, so the two cannot drift.
    const reassignedAgent =
      assigneeAgentId !== undefined && !!current?.agentId && assigneeAgentId !== current.agentId;
    const currentExecution = reassignedAgent ? readTaskExecutionConfig(current?.config) : undefined;
    const clearedExecution = reassignedAgent
      ? clearTaskReposSelection(currentExecution)
      : undefined;
    const clearedConfig =
      reassignedAgent && clearedExecution !== currentExecution
        ? { ...current?.config, execution: toTaskExecutionConfigPatch(clearedExecution) }
        : undefined;
    const optimistic: Partial<TaskDetailData> = {
      ...optimisticRest,
      ...(assigneeAgentId !== undefined ? { agentId: assigneeAgentId } : {}),
      ...(assigneeUserId !== undefined ? { userId: assigneeUserId } : {}),
      ...(clearedConfig ? { config: clearedConfig } : {}),
      ...(optimisticActivities.length > 0 || priorityRow ? { activities } : {}),
    };
    const payload = options?.actorAgentId ? { ...data, actorAgentId: options.actorAgentId } : data;

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

    const collections = this.#get().internal_beginCollectionTaskOptimistic(id, (task) => ({
      ...task,
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.priority !== undefined ? { priority: data.priority } : {}),
      ...(data.assigneeAgentId !== undefined ? { assigneeAgentId: data.assigneeAgentId } : {}),
      ...(data.assigneeUserId !== undefined ? { assigneeUserId: data.assigneeUserId } : {}),
    }));

    this.internal_dispatchTaskDetail(
      { id, type: 'updateTaskDetail', value: optimistic },
      options?.source === 'editor' ? undefined : { instructionSource: 'external' },
    );

    await runMutation(this.#set, this.#get, {
      mutate: () => taskService.update(id, payload),
      name: 'updateTask',
      // Rollback is a server-truth refetch (not a local snapshot), so the
      // optimistic dispatch above is reconciled from the source of record.
      onError: async (error) => {
        collections.rollback();
        await refreshPatchedTargets();
        /**
         * The rollback refetch has already replaced the editor's failed local
         * content. Treating Retry as another editor echo would update only the
         * Store and server, leaving the mounted editor on the rollback snapshot.
         */
        const retry =
          options?.retry ??
          (() =>
            void this.#get().updateTask(id, data, {
              ...options,
              source: 'external',
            }));
        saveToast(error, { retry });
      },
      setStatus: (status) => this.#get().internal_setTaskSaveStatus(id, status),
    });

    collections.commit();

    // Saved: the edited detail is now the server's value, so a reload must
    // paint it rather than the pre-edit snapshot.
    this.internal_persistTaskDetail(id);
    if (patchedParentId) this.internal_persistTaskDetail(patchedParentId);

    if (
      assigneeAgentId !== undefined ||
      assigneeUserId !== undefined ||
      data.parentTaskId !== undefined ||
      data.priority !== undefined
    ) {
      await Promise.all([
        this.#get().refreshTaskList(),
        refreshPatchedTargets(),
        // A goal page names each task's executor from its own graph snapshot,
        // and only polls while the goal is advancing — a paused or finished
        // goal would keep showing the old assignee. The task does not know its
        // goal, so revalidate every goal graph; only mounted ones refetch.
        assigneeAgentId !== undefined ? revalidateReplica(goalGraphResource) : undefined,
      ]).catch(() => {});
    }
  };

  useFetchTaskDetail = (taskRef?: string) => {
    const scope = cacheScope.use();
    const knownId = useTaskStore((state) => cachedTaskId(taskRef, state.taskRefIndex));
    const resolution = useClientDataSWR(
      taskRef && !knownId ? ['taskRef', scope, taskRef] : null,
      async () => {
        try {
          return await this.internal_resolveTaskId(taskRef!);
        } catch (error) {
          if ((error as { data?: { code?: string } })?.data?.code === 'NOT_FOUND') {
            const missing = new Error('Task not found') as Error & { code: string };
            missing.code = 'TASK_NOT_FOUND';
            throw missing;
          }
          throw error;
        }
      },
    );
    const taskId = knownId;
    const shouldPoll = useTaskStore((state) =>
      hasInFlightActivity(taskId ? state.taskDetailMap[taskId] : undefined),
    );
    const sync = this.#detail.useSync(taskId, {
      onError: (error) => {
        if (taskId && (error as { code?: string } | undefined)?.code === 'TASK_NOT_FOUND')
          this.internal_dispatchTaskDetail({ id: taskId, type: 'deleteTaskDetail' });
      },
      refreshInterval: shouldPoll ? TASK_DETAIL_POLL_INTERVAL : 0,
    });
    return {
      ...sync,
      error: resolution.error ?? sync.error,
      isValidating: resolution.isLoading || sync.isValidating,
      mutate: taskId ? sync.revalidate : resolution.mutate,
    };
  };

  #forgetTask = (id: string) => {
    const taskRefIndex = Object.fromEntries(
      Object.entries(this.#get().taskRefIndex).filter(([, taskId]) => taskId !== id),
    );
    this.#set({ taskRefIndex }, false, 'taskDetail/forgetRef');
  };

  #rememberTask = (task: { id: string; identifier: string }, ref: string) => {
    const state = this.#get();
    this.#set(
      {
        taskRefIndex: {
          ...state.taskRefIndex,
          [ref]: task.id,
          [task.id]: task.id,
          [task.identifier]: task.id,
        },
        ...(state.activeTaskRef === ref ||
        state.activeTaskRef === task.id ||
        state.activeTaskRef === task.identifier
          ? { activeTaskId: task.id }
          : {}),
      },
      false,
      'taskDetail/resolveRef',
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

  /**
   * Apply a detail change (subtasks are patched inside their parent's entry
   * too) and write every changed entry through the replica. In memory only:
   * the confirmed server value is persisted by the detail sync.
   */
  internal_dispatchTaskDetail = (
    payload: TaskDetailDispatch,
    options?: { instructionSource?: 'external' },
  ): void => {
    const ref = payload.id;
    if (payload.type === 'setTaskDetail') {
      if (!payload.value.id) return;
      this.#rememberTask({ ...payload.value, id: payload.value.id }, ref);
    }
    payload = {
      ...payload,
      id:
        payload.type === 'setTaskDetail'
          ? payload.value.id!
          : (this.#get().taskRefIndex[ref] ?? ref),
    };
    const state = this.#get();
    const currentMap = state.taskDetailMap;
    const nextMap = taskDetailReducer(currentMap, payload);
    const shouldIncrementInstructionRevision =
      options?.instructionSource === 'external' &&
      hasInstructionSnapshotChanged(currentMap[payload.id], nextMap[payload.id]);
    const shouldDeleteInstructionRevision =
      payload.type === 'deleteTaskDetail' &&
      state.taskInstructionRevisionMap[payload.id] !== undefined;

    if (payload.type === 'deleteTaskDetail') {
      if (currentMap[payload.id]) this.#detail.remove(payload.id);
    } else {
      for (const id of new Set([...Object.keys(currentMap), ...Object.keys(nextMap)])) {
        if (currentMap[id] === nextMap[id] || isEqual(currentMap[id], nextMap[id])) continue;
        this.#detail.update(id, () => nextMap[id], { persist: false });
      }
    }

    if (shouldIncrementInstructionRevision) {
      this.#set(
        {
          taskInstructionRevisionMap: {
            ...state.taskInstructionRevisionMap,
            [payload.id]: (state.taskInstructionRevisionMap[payload.id] ?? 0) + 1,
          },
        },
        false,
        `internal_dispatchTaskDetail/${payload.type}`,
      );
    } else if (shouldDeleteInstructionRevision) {
      const taskInstructionRevisionMap = { ...state.taskInstructionRevisionMap };
      delete taskInstructionRevisionMap[payload.id];
      this.#set(
        { taskInstructionRevisionMap },
        false,
        `internal_dispatchTaskDetail/${payload.type}`,
      );
    }
  };

  /**
   * Persist a task's detail as it is shown now — called once a save settles
   * (committed, or rolled back), since edits stay in memory while in flight.
   */
  internal_persistTaskDetail = (id: string): void => {
    this.#detail.update(id, (detail) => detail && { ...detail });
  };

  internal_refreshTaskDetail = async (ref: string): Promise<void> => {
    const id = await this.internal_resolveTaskId(ref);
    await this.#detail.revalidate(id);
  };
}

export type TaskDetailSliceAction = Pick<
  TaskDetailSliceActionImpl,
  keyof TaskDetailSliceActionImpl
>;
