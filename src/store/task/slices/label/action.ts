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

  constructor(set: Setter, get: () => TaskStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  /** The workspace (or personal) label registry; scope is part of the SWR key. */
  useFetchTaskLabels = (enabled = true) =>
    useClientDataSWR<TaskLabelWithUsage[]>(
      enabled ? taskLabelKeys.list() : null,
      () => taskLabelService.list(),
      {
        onSuccess: (data: TaskLabelWithUsage[]) => {
          this.#set({ taskLabels: data, taskLabelsInit: true }, false, 'useFetchTaskLabels');
        },
      },
    );

  refreshTaskLabels = async (): Promise<void> => {
    await mutate(taskLabelKeys.list());
  };

  createTaskLabel = async (params: TaskLabelInput) => {
    const label = await taskLabelService.create(params);
    // Show the new label right away; the refetch fills in usage counts.
    this.#set(
      (state) => ({ taskLabels: [...state.taskLabels, { ...label, usageCount: 0 }] }),
      false,
      'createTaskLabel',
    );
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
   * page and every loaded list/board. Only the delta goes over the wire, as
   * add/remove calls, so a concurrent editor's change to other labels survives.
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
      if (removed.length > 0) await taskLabelService.removeFromTask(taskId, removed);
      if (added.length > 0) await taskLabelService.addToTask(taskId, added);
      collections.commit();
    } catch (error) {
      collections.rollback();
      saveToast(error);
      if (hasDetail) await this.#get().internal_refreshTaskDetail(taskId);
      return false;
    }

    await Promise.all([
      hasDetail ? this.#get().internal_refreshTaskDetail(taskId) : undefined,
      this.#get().refreshTaskList(),
      this.refreshTaskLabels(),
    ]).catch(() => {});
    return true;
  };
}

export type TaskLabelSliceAction = Pick<TaskLabelSliceActionImpl, keyof TaskLabelSliceActionImpl>;
