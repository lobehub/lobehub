import type { TaskAutomationMode } from '@lobechat/types';

/** The schedule a scheduled task is created with, before it exists to be updated. */
export interface ScheduleDraft {
  /** `null` = continuous, matching `tasks.config.schedule.maxExecutions`. */
  maxExecutions: number | null;
  pattern: string;
  timezone: string;
}

// Same defaults the detail page writes when automation is first switched on.
const DEFAULT_SCHEDULE_PATTERN = '0 9 * * *';

const resolveLocalTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

export const createDefaultScheduleDraft = (): ScheduleDraft => ({
  maxExecutions: null,
  pattern: DEFAULT_SCHEDULE_PATTERN,
  timezone: resolveLocalTimezone(),
});

/**
 * The `task.create` fields that make the new task a live schedule; the server
 * creates a schedule-mode task already `scheduled`. `maxExecutions` lives in
 * the `config.schedule` pocket and is merged over any other config the form
 * sends.
 */
export const toScheduledCreateParams = (
  draft: ScheduleDraft,
  config?: Record<string, unknown>,
): {
  automationMode: TaskAutomationMode;
  config?: Record<string, unknown>;
  schedulePattern: string;
  scheduleTimezone: string;
} => ({
  automationMode: 'schedule',
  config:
    draft.maxExecutions === null
      ? config
      : { ...config, schedule: { maxExecutions: draft.maxExecutions } },
  schedulePattern: draft.pattern,
  scheduleTimezone: draft.timezone,
});
