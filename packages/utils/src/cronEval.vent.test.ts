import { describe, expect, it } from 'vitest';

import { isExecutionTime, SCHEDULE_DISPATCH_INTERVAL_MINUTES } from './cronEval';

const at = (iso: string) => new Date(iso);

// Reproductions of scheduled tasks that fired early, fired twice, or stopped
// firing in production. Times and patterns are copied from real task rows.
describe('isExecutionTime — scheduled task misfire regressions', () => {
  it('A: one-shot date cron must not fire 7 days early (T-9, Asia/Shanghai)', () => {
    expect(
      isExecutionTime({
        cronPattern: '0 10 27 9 *',
        currentTime: at('2026-09-20T03:20:00Z'),
        lastExecutedAt: null,
        timezone: 'Asia/Shanghai',
      }),
    ).toBe(false);
  });

  it('A: one-shot date cron must not fire 5 weeks early (T-2, Europe/Moscow)', () => {
    expect(
      isExecutionTime({
        cronPattern: '0 12 27 10 *',
        currentTime: at('2026-09-18T20:00:00Z'),
        lastExecutedAt: null,
        timezone: 'Europe/Moscow',
      }),
    ).toBe(false);
  });

  it('E: freshly armed daily "5 0" must wait for next 00:05, not fire at 01:55', () => {
    expect(
      isExecutionTime({
        cronPattern: '5 0 * * *',
        currentTime: at('2026-09-17T15:55:00Z'),
        lastExecutedAt: null,
        timezone: 'Australia/Sydney',
      }),
    ).toBe(false);
  });

  it('B: "5 0 * * *" must not fire at 00:00 (before target)', () => {
    expect(
      isExecutionTime({
        cronPattern: '5 0 * * *',
        currentTime: at('2026-09-18T14:00:00Z'),
        lastExecutedAt: at('2026-09-17T14:06:00Z'),
        timezone: 'Australia/Sydney',
      }),
    ).toBe(false);
  });

  it('C: hour-list "0 8,10,...,20" must not refire at :05 after running at :00', () => {
    expect(
      isExecutionTime({
        cronPattern: '0 8,10,12,14,16,18,20 * * *',
        currentTime: at('2026-09-21T19:05:00Z'),
        lastExecutedAt: at('2026-09-21T19:02:33Z'),
        timezone: 'America/Los_Angeles',
      }),
    ).toBe(false);
  });

  it('D: "45 11 * * 1-5" must fire on Tuesday 11:45 (T-13)', () => {
    expect(
      isExecutionTime({
        cronPattern: '45 11 * * 1-5',
        currentTime: at('2026-09-22T04:45:00Z'),
        lastExecutedAt: at('2026-09-21T05:00:24Z'),
        timezone: 'Asia/Ho_Chi_Minh',
      }),
    ).toBe(true);
  });

  describe('dispatcher replay (10-minute ticks from the arm time)', () => {
    const TICK_MS = SCHEDULE_DISPATCH_INTERVAL_MINUTES * 60 * 1000;

    /** Replays the central dispatcher and returns every tick that fired. */
    const replay = (cronPattern: string, timezone: string, armedAt: string, until: string) => {
      const fires: string[] = [];
      let lastExecutedAt: Date | null = null;
      const start = Math.ceil(at(armedAt).getTime() / TICK_MS) * TICK_MS;
      for (let t = start; t <= at(until).getTime(); t += TICK_MS) {
        const currentTime = new Date(t);
        if (
          isExecutionTime({
            armedAt: at(armedAt),
            cronPattern,
            currentTime,
            lastExecutedAt,
            timezone,
          })
        ) {
          fires.push(currentTime.toISOString());
          lastExecutedAt = currentTime;
        }
      }
      return fires;
    };

    it('A1: T-9 "0 10 27 9 *" armed 09-20 fires only on 09-27 10:00 Shanghai', () => {
      expect(
        replay('0 10 27 9 *', 'Asia/Shanghai', '2026-09-20T03:15:55Z', '2026-09-28T00:00:00Z'),
      ).toEqual(['2026-09-27T02:00:00.000Z']);
    });

    it('B1: Sydney "5 0 * * *" fires once per night, on the first tick after 00:05', () => {
      expect(
        replay('5 0 * * *', 'Australia/Sydney', '2026-09-17T15:50:17Z', '2026-09-20T23:00:00Z'),
      ).toEqual([
        '2026-09-18T14:10:00.000Z',
        '2026-09-19T14:10:00.000Z',
        '2026-09-20T14:10:00.000Z',
      ]);
    });

    it('C1: LA hour list fires once per window', () => {
      expect(
        replay(
          '0 8,10,12,14,16,18,20 * * *',
          'America/Los_Angeles',
          '2026-09-21T14:30:00Z',
          '2026-09-22T04:00:00Z',
        ),
      ).toEqual([
        '2026-09-21T15:00:00.000Z',
        '2026-09-21T17:00:00.000Z',
        '2026-09-21T19:00:00.000Z',
        '2026-09-21T21:00:00.000Z',
        '2026-09-21T23:00:00.000Z',
        '2026-09-22T01:00:00.000Z',
        '2026-09-22T03:00:00.000Z',
      ]);
    });

    it('D1: T-13 "45 11 * * 1-5" fires every weekday (11:50 tick), not only Monday', () => {
      expect(
        replay('45 11 * * 1-5', 'Asia/Ho_Chi_Minh', '2026-09-21T13:01:40Z', '2026-09-28T23:00:00Z'),
      ).toEqual([
        '2026-09-22T04:50:00.000Z',
        '2026-09-23T04:50:00.000Z',
        '2026-09-24T04:50:00.000Z',
        '2026-09-25T04:50:00.000Z',
        '2026-09-28T04:50:00.000Z',
      ]);
    });

    it('E1: daily "0 9 * * *" armed at 09:05 skips that 09:00 and fires the next day', () => {
      expect(replay('0 9 * * *', 'UTC', '2026-09-21T09:05:00Z', '2026-09-22T12:00:00Z')).toEqual([
        '2026-09-22T09:00:00.000Z',
      ]);
    });
  });
});
