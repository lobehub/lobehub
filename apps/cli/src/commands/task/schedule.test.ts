import { describe, expect, it } from 'vitest';

import { formatTaskSchedule, toCreateScheduleInput, toEditScheduleInput } from './schedule';

describe('toCreateScheduleInput', () => {
  it('sends nothing when no flag is given', () => {
    expect(toCreateScheduleInput({})).toEqual({ input: {}, scheduleConfig: undefined });
  });

  it('turns a cron into schedule mode', () => {
    expect(
      toCreateScheduleInput({ schedule: '0 22 * * *', timezone: 'Asia/Shanghai' }).input,
    ).toEqual({
      automationMode: 'schedule',
      schedulePattern: '0 22 * * *',
      scheduleTimezone: 'Asia/Shanghai',
    });
  });

  it('keeps an explicit automation mode', () => {
    expect(toCreateScheduleInput({ automation: 'heartbeat' }).input).toEqual({
      automationMode: 'heartbeat',
    });
    expect(() => toCreateScheduleInput({ automation: 'none' })).toThrow('Invalid automation');
  });

  it('puts max executions into config.schedule', () => {
    expect(toCreateScheduleInput({ maxExecutions: '3' }).scheduleConfig).toEqual({
      schedule: { maxExecutions: 3 },
    });
  });

  it.each(['0', '-1', '1.5', 'abc'])('rejects max executions %s', (maxExecutions) => {
    expect(() => toCreateScheduleInput({ maxExecutions })).toThrow('--max-executions');
  });
});

describe('toEditScheduleInput', () => {
  it('leaves omitted flags alone', () => {
    expect(toEditScheduleInput({})).toEqual({ configPatch: undefined, input: {} });
  });

  it('clears cron and timezone but not the mode', () => {
    expect(toEditScheduleInput({ scheduleClear: true }).input).toEqual({
      schedulePattern: null,
      scheduleTimezone: null,
    });
  });

  it('disables automation with --automation none', () => {
    expect(toEditScheduleInput({ automation: 'none' }).input).toEqual({ automationMode: null });
  });

  it('refuses a cron together with --schedule-clear', () => {
    expect(() => toEditScheduleInput({ schedule: '0 0 * * *', scheduleClear: true })).toThrow(
      'cannot be used together',
    );
  });

  it('patches or removes max executions', () => {
    expect(toEditScheduleInput({ maxExecutions: '2' }).configPatch).toEqual({
      schedule: { maxExecutions: 2 },
    });
    expect(toEditScheduleInput({ maxExecutions: 'null' }).configPatch).toEqual({
      schedule: { maxExecutions: null },
    });
  });
});

describe('formatTaskSchedule', () => {
  it('joins the configured parts', () => {
    expect(
      formatTaskSchedule({ maxExecutions: 1, pattern: '0 22 * * *', timezone: 'Asia/Shanghai' }),
    ).toBe('0 22 * * * · Asia/Shanghai · max 1');
    expect(formatTaskSchedule({ maxExecutions: null, pattern: '0 9 * * *', timezone: null })).toBe(
      '0 9 * * *',
    );
  });

  it('shows none when unconfigured', () => {
    expect(formatTaskSchedule(undefined)).toBe('none');
    expect(formatTaskSchedule({ maxExecutions: null, pattern: null, timezone: null })).toBe('none');
  });
});
