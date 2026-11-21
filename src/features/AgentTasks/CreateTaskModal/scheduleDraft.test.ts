import { describe, expect, it } from 'vitest';

import { createDefaultScheduleDraft, toScheduledCreateParams } from './scheduleDraft';

describe('createDefaultScheduleDraft', () => {
  it('defaults to a continuous daily 09:00 schedule', () => {
    const draft = createDefaultScheduleDraft();

    expect(draft.pattern).toBe('0 9 * * *');
    expect(draft.maxExecutions).toBeNull();
    expect(draft.timezone).toBeTruthy();
  });
});

describe('toScheduledCreateParams', () => {
  it('creates the task in schedule mode with the drafted cron and timezone', () => {
    expect(
      toScheduledCreateParams({
        maxExecutions: null,
        pattern: '30 8 * * 1,2,3',
        timezone: 'Asia/Shanghai',
      }),
    ).toEqual({
      automationMode: 'schedule',
      config: undefined,
      schedulePattern: '30 8 * * 1,2,3',
      scheduleTimezone: 'Asia/Shanghai',
    });
  });

  it('keeps other config and adds a run limit under config.schedule', () => {
    const execution = { deviceId: 'dev_1' };

    expect(
      toScheduledCreateParams(
        { maxExecutions: 5, pattern: '0 9 * * *', timezone: 'UTC' },
        { execution },
      ).config,
    ).toEqual({ execution, schedule: { maxExecutions: 5 } });
  });

  it('leaves config untouched for a continuous schedule', () => {
    const config = { execution: { deviceId: 'dev_1' } };

    expect(
      toScheduledCreateParams(
        { maxExecutions: null, pattern: '0 9 * * *', timezone: 'UTC' },
        config,
      ).config,
    ).toBe(config);
  });
});
