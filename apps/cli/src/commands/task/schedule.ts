import { readFlag } from './model';

/**
 * Schedule flags of `task create` / `task edit`. Only explicit values are sent,
 * and the cron itself is judged by the server (`scheduleValidation.ts`).
 */
export interface TaskScheduleOptions {
  automation?: string;
  maxExecutions?: string;
  schedule?: string;
  scheduleClear?: boolean;
  timezone?: string;
}

type AutomationMode = 'heartbeat' | 'schedule';

const AUTOMATION_MODES = new Set<string>(['heartbeat', 'schedule']);

const readAutomation = (value: string | undefined): AutomationMode | undefined => {
  if (value === undefined) return undefined;
  if (!AUTOMATION_MODES.has(value)) {
    throw new Error(`Invalid automation mode "${value}". Must be one of: heartbeat, schedule`);
  }
  return value as AutomationMode;
};

const readMaxExecutions = (value: string): number => {
  const parsed = /^\d+$/.test(value.trim()) ? Number.parseInt(value, 10) : 0;
  if (parsed < 1) throw new Error(`--max-executions must be a positive integer, got "${value}"`);
  return parsed;
};

/**
 * `task.create` fields, matching the app's create form: a cron without an
 * explicit mode means schedule mode, because the dispatcher ignores a pattern on
 * any other task. The server creates such a task already `scheduled`.
 */
export const toCreateScheduleInput = (options: TaskScheduleOptions) => {
  const automationMode = readAutomation(options.automation);
  const input: {
    automationMode?: AutomationMode;
    schedulePattern?: string;
    scheduleTimezone?: string;
  } = {};
  if (options.schedule) input.schedulePattern = options.schedule;
  if (options.timezone) input.scheduleTimezone = options.timezone;
  if (automationMode) input.automationMode = automationMode;
  else if (options.schedule) input.automationMode = 'schedule';

  return {
    input,
    scheduleConfig:
      options.maxExecutions === undefined
        ? undefined
        : { schedule: { maxExecutions: readMaxExecutions(options.maxExecutions) } },
  };
};

/**
 * `task.update` fields.
 * - `--schedule` without `--automation` switches to schedule mode, as on create.
 * - `--schedule-clear` clears cron and timezone but keeps the mode, so it cannot
 *   turn off a heartbeat; `--automation none` disables automation.
 * - `--max-executions null` removes the limit. It is a `configPatch` key, so the
 *   rest of `config` survives.
 */
export const toEditScheduleInput = (options: TaskScheduleOptions) => {
  if (options.scheduleClear && options.schedule) {
    throw new Error('--schedule and --schedule-clear cannot be used together');
  }

  const input: {
    automationMode?: AutomationMode | null;
    schedulePattern?: string | null;
    scheduleTimezone?: string | null;
  } = {};
  if (options.schedule) input.schedulePattern = options.schedule;
  if (options.timezone) input.scheduleTimezone = options.timezone;
  if (options.scheduleClear) {
    input.schedulePattern = null;
    input.scheduleTimezone = null;
  }

  if (options.automation === 'none') input.automationMode = null;
  else {
    const automationMode = readAutomation(options.automation);
    if (automationMode) input.automationMode = automationMode;
    else if (options.schedule) input.automationMode = 'schedule';
  }

  const maxExecutions = readFlag(options.maxExecutions);
  return {
    configPatch:
      maxExecutions === undefined
        ? undefined
        : {
            schedule: {
              maxExecutions: maxExecutions === null ? null : readMaxExecutions(maxExecutions),
            },
          },
    input,
  };
};

/** The Schedule line of `task view`, e.g. `0 22 * * * · Asia/Shanghai · max 1`. */
export const formatTaskSchedule = (
  schedule:
    | { maxExecutions?: number | null; pattern?: string | null; timezone?: string | null }
    | null
    | undefined,
): string => {
  const parts = [
    schedule?.pattern,
    schedule?.timezone,
    schedule?.maxExecutions == null ? undefined : `max ${schedule.maxExecutions}`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'none';
};
