import type { CheckpointConfig, TaskAutomationMode } from '@lobechat/types';

import { taskService } from '@/services/task';
import type { StoreSetter } from '@/store/types';

import type { TaskStore } from '../../store';

// Default values applied when a task is switched into a mode for the first time
// — keeps the popover summary, the cron runtime and the persisted record in
// sync rather than leaving the task in a "mode enabled but unconfigured" state.
const DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 600;
const DEFAULT_SCHEDULE_PATTERN = '0 9 * * *';
const resolveDefaultTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

type Setter = StoreSetter<TaskStore>;

export const createTaskConfigSlice = (set: Setter, get: () => TaskStore, _api?: unknown) =>
  new TaskConfigSliceActionImpl(set, get, _api);

export class TaskConfigSliceActionImpl {
  readonly #get: () => TaskStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => TaskStore, _api?: unknown) {
    void _api;
    this.#set = set;
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
    // Optimistic update — immediately reflect new model/provider in UI
    this.#get().internal_dispatchTaskDetail({
      id,
      type: 'updateTaskDetail',
      value: { config: { ...this.#get().taskDetailMap[id]?.config, ...modelConfig } },
    });
    this.#set({ taskSaveStatus: 'saving' }, false, 'updateTaskModelConfig/saving');

    try {
      await taskService.updateConfig(id, modelConfig);
      this.#set({ taskSaveStatus: 'saved' }, false, 'updateTaskModelConfig/saved');
      await this.#get().internal_refreshTaskDetail(id);
    } catch (error) {
      console.error('[TaskStore] Failed to update task model config:', error);
      this.#set({ taskSaveStatus: 'idle' }, false, 'updateTaskModelConfig/error');
      await this.#get().internal_refreshTaskDetail(id);
    }
  };

  // Configure periodic execution interval (heartbeatInterval in seconds).
  // Whether automation runs is decided by automationMode (controlled separately by setAutomationMode).
  updatePeriodicInterval = async (id: string, interval: number | null): Promise<void> => {
    try {
      await taskService.update(id, { heartbeatInterval: interval ?? 0 });
      await this.#get().internal_refreshTaskDetail(id);
    } catch (error) {
      console.error('[TaskStore] Failed to update periodic interval:', error);
    }
  };

  // Switch between automation modes; null = disable automation. When entering a
  // mode that has never been configured, also persist the mode's defaults so the
  // popover summary, cron runtime and DB row stay aligned.
  setAutomationMode = async (id: string, mode: TaskAutomationMode | null): Promise<void> => {
    const detail = this.#get().taskDetailMap[id];

    const update: Parameters<typeof taskService.update>[1] = { automationMode: mode };
    if (mode === 'heartbeat' && !detail?.heartbeat?.interval) {
      update.heartbeatInterval = DEFAULT_HEARTBEAT_INTERVAL_SECONDS;
    }
    if (mode === 'schedule') {
      // The DB column defaults `scheduleTimezone` to 'UTC' on row creation, so a
      // missing `pattern` is the reliable signal that the user has never opened
      // the schedule form. Treat that case as first-time enable and override the
      // DB default with the user's local timezone.
      if (!detail?.schedule?.pattern) {
        update.schedulePattern = DEFAULT_SCHEDULE_PATTERN;
        update.scheduleTimezone = resolveDefaultTimezone();
      } else if (!detail?.schedule?.timezone) {
        update.scheduleTimezone = resolveDefaultTimezone();
      }
    }

    // Optimistic update so the Segmented reflects the new tab immediately
    this.#get().internal_dispatchTaskDetail({
      id,
      type: 'updateTaskDetail',
      value: { automationMode: mode },
    });

    try {
      await taskService.update(id, update);
      await this.#get().internal_refreshTaskDetail(id);
    } catch (error) {
      console.error('[TaskStore] Failed to update automation mode:', error);
      await this.#get().internal_refreshTaskDetail(id);
    }
  };

  // Configure schedule mode: cron pattern + IANA timezone are columns; maxExecutions
  // (null = unlimited / continuous) lives in `tasks.config.schedule` JSONB pocket.
  // Whether the schedule actually fires depends on automationMode === 'schedule'.
  updateSchedule = async (
    id: string,
    schedule: { maxExecutions: number | null; pattern: string; timezone: string },
  ): Promise<void> => {
    const existingConfig =
      (this.#get().taskDetailMap[id]?.config as Record<string, unknown> | undefined) ?? {};
    const existingScheduleConfig =
      (existingConfig.schedule as Record<string, unknown> | undefined) ?? {};

    try {
      await taskService.update(id, {
        config: {
          ...existingConfig,
          schedule: { ...existingScheduleConfig, maxExecutions: schedule.maxExecutions },
        },
        schedulePattern: schedule.pattern,
        scheduleTimezone: schedule.timezone,
      });
      await this.#get().internal_refreshTaskDetail(id);
    } catch (error) {
      console.error('[TaskStore] Failed to update schedule:', error);
      await this.#get().internal_refreshTaskDetail(id);
    }
  };
}

export type TaskConfigSliceAction = Pick<
  TaskConfigSliceActionImpl,
  keyof TaskConfigSliceActionImpl
>;
