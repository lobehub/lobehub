import type { TaskLabelRef, TaskLabelWithUsage } from '@lobechat/types';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { taskLabelKeys } from '@/libs/swr/keys';
import { type TaskLabelInput, type TaskLabelPatch, taskLabelService } from '@/services/taskLabel';
import type { StoreSetter } from '@/store/types';
import { saveToast } from '@/store/utils/saveToast';

import type { TaskStore } from '../../store';

type Setter = StoreSetter<TaskStore>;

/** Ids added and removed going from `current` to `next`. */
export const diffTaskLabels = (current: TaskLabelRef[], next: TaskLabelRef[]) => {
  const currentIds = new Set(current.map((label) => label.id));
  const nextIds = new Set(next.map((label) => label.id));
  return {
    added: [...nextIds].filter((id) => !currentIds.has(id)),
    removed: [...currentIds].filter((id) => !nextIds.has(id)),
  };
};

export const createTaskLabelSlice = (set: Setter, get: () => TaskStore, _api?: unknown) =>
  new TaskLabelSliceActionImpl(set, get, _api);

export class TaskLabelSliceActionImpl {
  readonly #get: () => TaskStore;
  readonly #set: Setter;
  /**
   * Per-task chain of label writes. Each call carries the delta the user saw
   * when clicking; sending them one after another keeps the server in click
   * order (its row lock orders by arrival, which rapid toggles can invert).
   */
  readonly #labelWrites = new Map<string, Promise<unknown>>();

  constructor(set: Setter, get: () => TaskStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  /**
   * The workspace (or personal) label registry. SWR already keys the request by
   * workspace; `scope` is the workspace the caller rendered with, so a response
   * that lands after the user switched away is not written into the shared slot.
   */
  useFetchTaskLabels = (enabled: boolean, scope: string | null) =>
    useClientDataSWR<TaskLabelWithUsage[]>(
      enabled ? taskLabelKeys.list() : null,
      () => taskLabelService.list(),
      {
        onSuccess: (data: TaskLabelWithUsage[]) => {
          if (this.#get().taskLabelsScope !== scope) return;
          this.#set({ taskLabels: data, taskLabelsInit: true }, false, 'useFetchTaskLabels');
        },
      },
    );

  /** Point the registry at another workspace, dropping the previous one's labels. */
  internal_resetTaskLabelsScope = (scope: string | null) => {
    if (this.#get().taskLabelsScope === scope) return;
    this.#set(
      { taskLabels: [], taskLabelsInit: false, taskLabelsScope: scope },
      false,
      'resetTaskLabelsScope',
    );
  };

  refreshTaskLabels = async (): Promise<void> => {
    await mutate(taskLabelKeys.list());
  };

  createTaskLabel = async (params: TaskLabelInput) => {
    const scope = this.#get().taskLabelsScope;
    const label = await taskLabelService.create(params);
    // Show the new label right away; the refetch fills in usage counts. Skip
    // it if the user switched workspaces meanwhile: it belongs to the old one.
    if (this.#get().taskLabelsScope === scope) {
      this.#set(
        (state) => ({ taskLabels: [...state.taskLabels, { ...label, usageCount: 0 }] }),
        false,
        'createTaskLabel',
      );
    }
    void this.refreshTaskLabels();
    return label;
  };

  updateTaskLabel = async (id: string, value: TaskLabelPatch) => {
    await taskLabelService.update(id, value);
    await this.refreshTaskLabels();
    // Names and colors are denormalized onto task rows.
    void this.#get().refreshTaskList();
  };

  deleteTaskLabel = async (id: string) => {
    await taskLabelService.delete(id);
    await this.refreshTaskLabels();
    void this.#get().refreshTaskList();
  };

  /**
   * Replace a task's labels with `next`, shown optimistically on the detail
   * page and every loaded list/board. Only the delta goes over the wire (applied
   * atomically), so a concurrent editor's change to other labels survives.
   */
  setTaskLabels = async (
    taskId: string,
    current: TaskLabelRef[],
    next: TaskLabelRef[],
  ): Promise<boolean> => {
    const { added, removed } = diffTaskLabels(current, next);
    if (added.length === 0 && removed.length === 0) return true;

    const collections = this.#get().internal_beginCollectionTaskOptimistic(taskId, (task) => ({
      ...task,
      labels: next,
    }));
    const hasDetail = !!this.#get().taskDetailMap[taskId];
    if (hasDetail) {
      this.#get().internal_dispatchTaskDetail({
        id: taskId,
        type: 'updateTaskDetail',
        value: { labels: next },
      });
    }

    try {
      // One request, one transaction: on failure nothing was written, so
      // rolling the optimistic state back matches the server.
      const previous = this.#labelWrites.get(taskId) ?? Promise.resolve();
      const write = previous
        .catch(() => {})
        .then(() => taskLabelService.changeForTask(taskId, { add: added, remove: removed }));
      this.#labelWrites.set(taskId, write);
      try {
        await write;
      } finally {
        if (this.#labelWrites.get(taskId) === write) this.#labelWrites.delete(taskId);
      }
    } catch (error) {
      collections.rollback();
      if (hasDetail) {
        // Nothing was written, so the labels the user started from are the
        // server's; restore them now rather than trusting a refetch to.
        this.#get().internal_dispatchTaskDetail({
          id: taskId,
          type: 'updateTaskDetail',
          value: { labels: current },
        });
        void this.#get()
          .internal_refreshTaskDetail(taskId)
          .catch(() => {});
      }
      saveToast(error);
      return false;
    }

    // The overlay only swaps the row's labels; it cannot move a card to its
    // new label column or out of a label filter it no longer matches. Commit it
    // once the lists have re-fetched (placement then comes from the server);
    // if that refetch fails, drop the overlay rather than persist a row in a
    // collection it no longer belongs to — the next refetch shows it correctly.
    try {
      await this.#get().refreshTaskList();
      collections.commit();
    } catch {
      collections.rollback();
    }
    await Promise.all([
      hasDetail ? this.#get().internal_refreshTaskDetail(taskId) : undefined,
      this.refreshTaskLabels(),
    ]).catch(() => {});
    return true;
  };
}

export type TaskLabelSliceAction = Pick<TaskLabelSliceActionImpl, keyof TaskLabelSliceActionImpl>;
