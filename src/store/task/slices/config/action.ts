import type { CheckpointConfig, TaskAutomationMode, TaskDetailData } from '@lobechat/types';

import { taskService } from '@/services/task';
import type { StoreSetter } from '@/store/types';
import { OptimisticEngine } from '@/store/utils/optimisticEngine';

import type { TaskStore } from '../../store';

// Slice of TaskStore that the OptimisticEngine for setAutomationMode reads/writes.
// Keeping it narrow ensures `extractAffectedPaths` produces `taskDetailMap.<id>`
// keys so concurrent toggles for the same task serialize, while toggles for
// different tasks stay parallel.
interface AutomationModeOptimisticState {
  taskDetailMap: Record<string, TaskDetailData>;
}

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
  // Lazily-initialized engine shared by every action that mutates a task's
  // `taskDetailMap` entry (setAutomationMode, updateSchedule). Per-task path
  // conflicts serialize rapid edits for the same task while different tasks
  // stay parallel.
  #automationEngine?: OptimisticEngine<AutomationModeOptimisticState>;

  constructor(set: Setter, get: () => TaskStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  // `getState` exposes only the taskDetailMap slice so the engine's patches
  // refer to keys under it — needed for `extractAffectedPaths` to produce
  // `taskDetailMap.<id>` conflict keys.
  #getAutomationEngine = (): OptimisticEngine<AutomationModeOptimisticState> => {
    if (this.#automationEngine) return this.#automationEngine;
    this.#automationEngine = new OptimisticEngine(
      {
        getState: () => ({ taskDetailMap: this.#get().taskDetailMap }),
        setState: (next) =>
          this.#set(next as Partial<TaskStore>, false, 'taskConfig/automationEngine'),
      },
      { maxRetries: 0 },
    );
    return this.#automationEngine;
  };

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

    // Run through OptimisticEngine so concurrent toggles for the same task
    // serialize on the shared `taskDetailMap.<id>` patch path (preventing PUT
    // reordering on the wire) and a failure replays inverse patches to roll
    // the store back. Toggles on different tasks have disjoint paths and stay
    // parallel.
    //
    // The patch also mirrors every server-bound field locally, so no post-PUT
    // refresh is needed — refresh would be an async SWR write that could land
    // after the user's next click and clobber their latest state.
    const engine = this.#getAutomationEngine();
    const tx = engine.createTransaction(`setAutomationMode(${id})`);
    tx.set((draft) => {
      const target = draft.taskDetailMap[id];
      if (!target) return;
      target.automationMode = mode;
      if (update.heartbeatInterval !== undefined) {
        target.heartbeat ??= {};
        target.heartbeat.interval = update.heartbeatInterval;
      }
      if (update.schedulePattern !== undefined) {
        target.schedule ??= {};
        target.schedule.pattern = update.schedulePattern;
      }
      if (update.scheduleTimezone !== undefined) {
        target.schedule ??= {};
        target.schedule.timezone = update.scheduleTimezone;
      }
    });
    tx.mutation = async () => {
      await taskService.update(id, update);
    };

    try {
      await tx.commit();
    } catch (error) {
      // engine already rolled the optimistic patches back; just log.
      console.error('[TaskStore] Failed to update automation mode:', error);
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
    const nextConfig = {
      ...existingConfig,
      schedule: { ...existingScheduleConfig, maxExecutions: schedule.maxExecutions },
    };

    // Share the engine + path (taskDetailMap.<id>) with setAutomationMode, so
    // rapid SchedulerForm edits (weekday toggles, frequency switches, time
    // picks) serialize against each other AND against mode toggles. No PUT
    // reordering on the wire; no stale post-write refresh that could land
    // after the user's next click.
    //
    // The optimistic patch mirrors every field this call sends to the server
    // (`config` JSONB shape + flat `schedule.{pattern,timezone}` for the
    // normalized store copy), so we don't need a follow-up refresh — that
    // refresh used to be the race source: an async SWR write that could
    // arrive after the user's next click and overwrite their input.
    const engine = this.#getAutomationEngine();
    const tx = engine.createTransaction(`updateSchedule(${id})`);
    tx.set((draft) => {
      const target = draft.taskDetailMap[id];
      if (!target) return;
      target.config = nextConfig;
      target.schedule = {
        maxExecutions: schedule.maxExecutions,
        pattern: schedule.pattern,
        timezone: schedule.timezone,
      };
    });
    tx.mutation = async () => {
      await taskService.update(id, {
        config: nextConfig,
        schedulePattern: schedule.pattern,
        scheduleTimezone: schedule.timezone,
      });
    };

    try {
      await tx.commit();
    } catch (error) {
      // engine already rolled the optimistic patches back; just log.
      console.error('[TaskStore] Failed to update schedule:', error);
    }
  };
}

export type TaskConfigSliceAction = Pick<
  TaskConfigSliceActionImpl,
  keyof TaskConfigSliceActionImpl
>;
