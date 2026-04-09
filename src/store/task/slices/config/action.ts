import type { CheckpointConfig } from '@lobechat/types';

import { taskService } from '@/services/task';
import type { StoreSetter } from '@/store/types';

import type { TaskStore } from '../../store';

type Setter = StoreSetter<TaskStore>;

export const createTaskConfigSlice = (set: Setter, get: () => TaskStore, _api?: unknown) =>
  new TaskConfigSliceActionImpl(set, get, _api);

export class TaskConfigSliceActionImpl {
  readonly #get: () => TaskStore;

  constructor(set: Setter, get: () => TaskStore, _api?: unknown) {
    void _api;
    void set;
    this.#get = get;
  }

  markBriefRead = async (briefId: string): Promise<void> => {
    await taskService.markBriefRead(briefId);
    const { activeTaskId, internal_refreshTaskDetail } = this.#get();
    if (activeTaskId) await internal_refreshTaskDetail(activeTaskId);
  };

  resolveBrief = async (
    briefId: string,
    opts?: { action?: string; comment?: string },
  ): Promise<void> => {
    await taskService.resolveBrief(briefId, opts);
    const { activeTaskId, internal_refreshTaskDetail } = this.#get();
    if (activeTaskId) await internal_refreshTaskDetail(activeTaskId);
  };

  runReview = async (id: string, params?: { content?: string; topicId?: string }) => {
    try {
      const result = await taskService.runReview(id, params);
      await this.#get().internal_refreshTaskDetail(id);
      return result;
    } catch (error) {
      console.error('[TaskStore] Failed to run review:', error);
      throw error;
    }
  };

  updateCheckpoint = async (id: string, checkpoint: CheckpointConfig): Promise<void> => {
    this.#get().internal_dispatchTaskDetail({
      id,
      type: 'updateTaskDetail',
      value: { checkpoint },
    });

    try {
      await taskService.updateCheckpoint(id, checkpoint);
      await this.#get().internal_refreshTaskDetail(id);
    } catch (error) {
      console.error('[TaskStore] Failed to update checkpoint:', error);
      await this.#get().internal_refreshTaskDetail(id);
    }
  };

  updateReview = async (
    id: string,
    review: Parameters<typeof taskService.updateReview>[0]['review'],
  ): Promise<void> => {
    this.#get().internal_dispatchTaskDetail({
      id,
      type: 'updateTaskDetail',
      value: { review },
    });

    try {
      await taskService.updateReview({ id, review });
      await this.#get().internal_refreshTaskDetail(id);
    } catch (error) {
      console.error('[TaskStore] Failed to update review:', error);
      await this.#get().internal_refreshTaskDetail(id);
    }
  };

  // Safely merges model/provider into config via task.updateConfig without overwriting checkpoint/review
  updateTaskModelConfig = async (
    id: string,
    modelConfig: { model?: string; provider?: string },
  ): Promise<void> => {
    try {
      await taskService.updateConfig(id, modelConfig);
      await this.#get().internal_refreshTaskDetail(id);
    } catch (error) {
      console.error('[TaskStore] Failed to update task model config:', error);
    }
  };

  // Configures the periodic execution interval (heartbeatInterval field, in seconds; null or 0 disables it)
  // Backend periodic execution logic will take effect automatically once LOBE-6587 is ready; the frontend UI config can be completed in advance
  updatePeriodicInterval = async (id: string, interval: number | null): Promise<void> => {
    try {
      await taskService.update(id, { heartbeatInterval: interval ?? 0 });
      await this.#get().internal_refreshTaskDetail(id);
    } catch (error) {
      console.error('[TaskStore] Failed to update periodic interval:', error);
    }
  };

  // TODO [LOBE-6587]: Scheduled tasks (cron mode)
  // updateSchedule(id, { pattern, timezone }) — backend task.update schema does not yet expose schedulePattern/scheduleTimezone
}

export type TaskConfigSliceAction = Pick<
  TaskConfigSliceActionImpl,
  keyof TaskConfigSliceActionImpl
>;
