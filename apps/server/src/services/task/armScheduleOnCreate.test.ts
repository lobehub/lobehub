import { describe, expect, it } from 'vitest';

import { armScheduleOnCreate } from './armScheduleOnCreate';

const now = new Date('2026-10-18T09:00:00.000Z');

describe('armScheduleOnCreate', () => {
  it('creates a schedule-mode task as scheduled with its window opened', () => {
    expect(
      armScheduleOnCreate({ automationMode: 'schedule', schedulePattern: '0 9 * * *' }, now),
    ).toEqual({
      context: { scheduler: { scheduleStartedAt: '2026-10-18T09:00:00.000Z' } },
      status: 'scheduled',
    });
  });

  it('keeps the other context pockets', () => {
    const origin = { topicId: 'tpc_1' } as any;

    expect(
      armScheduleOnCreate(
        {
          automationMode: 'schedule',
          context: { origin, scheduler: { consecutiveFailures: 0 } },
          schedulePattern: '0 9 * * *',
        },
        now,
      ).context,
    ).toEqual({
      origin,
      scheduler: { consecutiveFailures: 0, scheduleStartedAt: '2026-10-18T09:00:00.000Z' },
    });
  });

  it('does not arm a schedule-mode task without a cron pattern', () => {
    expect(armScheduleOnCreate({ automationMode: 'schedule' }, now)).toEqual({});
    expect(armScheduleOnCreate({ automationMode: 'schedule', schedulePattern: '' }, now)).toEqual(
      {},
    );
  });

  it('leaves non-schedule tasks untouched', () => {
    expect(
      armScheduleOnCreate(
        { automationMode: 'heartbeat', context: { scheduler: { consecutiveFailures: 1 } } },
        now,
      ),
    ).toEqual({});
    expect(armScheduleOnCreate({}, now)).toEqual({});
  });
});
