import { describe, expect, it } from 'vitest';

import { isExecutionTime, validateCronPattern } from './cronEval';

const SHANGHAI = 'Asia/Shanghai';

const utc = (iso: string) => new Date(`${iso}Z`);
/** Build a UTC `Date` representing the given local wall-clock time in Shanghai (UTC+8). */
const shanghaiLocal = (iso: string) => new Date(`${iso}+08:00`);

describe('isExecutionTime', () => {
  describe('daily pattern — manual-trigger-before-scheduled-tick (regression)', () => {
    // Bug: when a user manually triggers a scheduled task earlier in the day,
    // `lastHeartbeatAt` advances. The dispatcher used to dedup by "same
    // calendar day", which made it skip the scheduled tick later that same
    // day. The fix is to dedup against today's scheduled target time, so a
    // pre-target manual run no longer eats the upcoming tick.

    it('fires daily 21:00 tick even if user manually triggered at 18:00 (UTC)', () => {
      // Daily at 21:00 UTC; manual run earlier today at 18:00.
      expect(
        isExecutionTime({
          cronPattern: '0 21 * * *',
          currentTime: utc('2026-04-29T21:00:00'),
          lastExecutedAt: utc('2026-04-29T18:00:00'),
          timezone: 'UTC',
        }),
      ).toBe(true);
    });

    it('fires daily 21:00 tick if manual trigger was at 18:00 local Shanghai', () => {
      // Same scenario but in Asia/Shanghai timezone.
      expect(
        isExecutionTime({
          cronPattern: '0 21 * * *',
          currentTime: shanghaiLocal('2026-04-29T21:00:00'),
          lastExecutedAt: shanghaiLocal('2026-04-29T18:00:00'),
          timezone: SHANGHAI,
        }),
      ).toBe(true);
    });

    it('fires the 7:30 daily tick when manual trigger happened at 06:00 same morning', () => {
      expect(
        isExecutionTime({
          cronPattern: '30 7 * * *',
          currentTime: utc('2026-04-29T07:30:00'),
          lastExecutedAt: utc('2026-04-29T06:00:00'),
          timezone: 'UTC',
        }),
      ).toBe(true);
    });
  });

  describe('daily pattern — dedup must still hold', () => {
    it('does NOT re-fire 30 minutes after the scheduled tick already ran', () => {
      // Scheduled tick fired at 21:00; dispatcher checks again at 21:30.
      expect(
        isExecutionTime({
          cronPattern: '0 21 * * *',
          currentTime: utc('2026-04-29T21:30:00'),
          lastExecutedAt: utc('2026-04-29T21:00:00'),
          timezone: 'UTC',
        }),
      ).toBe(false);
    });

    it('does NOT fire if user manually ran AFTER the scheduled target same day', () => {
      // Manual run at 22:00 covers today's 21:00 scheduled run; do not refire.
      expect(
        isExecutionTime({
          cronPattern: '0 21 * * *',
          currentTime: utc('2026-04-29T22:30:00'),
          lastExecutedAt: utc('2026-04-29T22:00:00'),
          timezone: 'UTC',
        }),
      ).toBe(false);
    });

    it('fires next day at 21:00 after running yesterday at 21:00', () => {
      expect(
        isExecutionTime({
          cronPattern: '0 21 * * *',
          currentTime: utc('2026-04-30T21:00:00'),
          lastExecutedAt: utc('2026-04-29T21:00:00'),
          timezone: 'UTC',
        }),
      ).toBe(true);
    });
  });

  describe('daily pattern — catch-up after missed scheduled time', () => {
    it('catches up a missed 21:00 tick within the grace window', () => {
      // Last run was yesterday at 21:00; the 21:00 and 21:05 ticks were lost.
      expect(
        isExecutionTime({
          cronPattern: '0 21 * * *',
          currentTime: utc('2026-04-29T21:10:00'),
          lastExecutedAt: utc('2026-04-28T21:00:00'),
          timezone: 'UTC',
        }),
      ).toBe(true);
    });

    it('does NOT replay a 21:00 occurrence two hours late — waits for the next one', () => {
      expect(
        isExecutionTime({
          cronPattern: '0 21 * * *',
          currentTime: utc('2026-04-29T23:00:00'),
          lastExecutedAt: utc('2026-04-28T21:00:00'),
          timezone: 'UTC',
        }),
      ).toBe(false);
    });

    it('does NOT catch-up after manual run already covered today (manual at 22:00, dispatcher at 23:00)', () => {
      expect(
        isExecutionTime({
          cronPattern: '0 21 * * *',
          currentTime: utc('2026-04-29T23:00:00'),
          lastExecutedAt: utc('2026-04-29T22:00:00'),
          timezone: 'UTC',
        }),
      ).toBe(false);
    });
  });

  describe('hourly / interval patterns', () => {
    it('every-hour-at-:00 does not refire on the next tick of the same hour', () => {
      // The 15:00 occurrence already ran at 15:00:03; the 15:05 tick must skip.
      expect(
        isExecutionTime({
          cronPattern: '0 * * * *',
          currentTime: utc('2026-04-29T15:05:00'),
          lastExecutedAt: utc('2026-04-29T15:00:03'),
          timezone: 'UTC',
        }),
      ).toBe(false);
    });

    it('every-hour-at-:00 still fires 15:00 after a manual run at 14:30', () => {
      expect(
        isExecutionTime({
          cronPattern: '0 * * * *',
          currentTime: utc('2026-04-29T15:00:00'),
          lastExecutedAt: utc('2026-04-29T14:30:00'),
          timezone: 'UTC',
        }),
      ).toBe(true);
    });

    it('every-hour-at-:00 fires after 60 minutes since last run', () => {
      expect(
        isExecutionTime({
          cronPattern: '0 * * * *',
          currentTime: utc('2026-04-29T15:00:00'),
          lastExecutedAt: utc('2026-04-29T14:00:00'),
          timezone: 'UTC',
        }),
      ).toBe(true);
    });

    it('*/30 pattern dedups within its 30-minute window', () => {
      expect(
        isExecutionTime({
          cronPattern: '*/30 * * * *',
          currentTime: utc('2026-04-29T15:15:00'),
          lastExecutedAt: utc('2026-04-29T15:00:00'),
          timezone: 'UTC',
        }),
      ).toBe(false);
    });
  });

  describe('weekly pattern', () => {
    it('weekly Wed 21:00: fires Wednesday after manual Wed-morning trigger', () => {
      // 2026-04-29 is a Wednesday (weekday=3).
      expect(
        isExecutionTime({
          cronPattern: '0 21 * * 3',
          currentTime: utc('2026-04-29T21:00:00'),
          lastExecutedAt: utc('2026-04-29T08:00:00'),
          timezone: 'UTC',
        }),
      ).toBe(true);
    });

    it('weekly Wed 21:00: does NOT fire on Thursday', () => {
      // 2026-04-30 is Thursday.
      expect(
        isExecutionTime({
          cronPattern: '0 21 * * 3',
          currentTime: utc('2026-04-30T21:00:00'),
          lastExecutedAt: utc('2026-04-22T21:00:00'),
          timezone: 'UTC',
        }),
      ).toBe(false);
    });
  });

  describe('full cron semantics', () => {
    it('honours day-of-month and month fields', () => {
      expect(
        isExecutionTime({
          cronPattern: '0 9 1 5 *',
          currentTime: utc('2026-05-01T09:00:00'),
          lastExecutedAt: null,
          timezone: 'UTC',
        }),
      ).toBe(true);
      expect(
        isExecutionTime({
          cronPattern: '0 9 1 5 *',
          currentTime: utc('2026-05-02T09:00:00'),
          lastExecutedAt: null,
          timezone: 'UTC',
        }),
      ).toBe(false);
    });

    it('treats a weekday range as every day in the range', () => {
      // 2026-04-30 is a Thursday.
      expect(
        isExecutionTime({
          cronPattern: '0 9 * * 1-5',
          currentTime: utc('2026-04-30T09:00:00'),
          lastExecutedAt: utc('2026-04-29T09:00:00'),
          timezone: 'UTC',
        }),
      ).toBe(true);
      // 2026-05-02 is a Saturday.
      expect(
        isExecutionTime({
          cronPattern: '0 9 * * 1-5',
          currentTime: utc('2026-05-02T09:00:00'),
          lastExecutedAt: utc('2026-05-01T09:00:00'),
          timezone: 'UTC',
        }),
      ).toBe(false);
    });

    it('fires each occurrence of a minute-offset pattern once, at or after the target', () => {
      const tick = (time: string, last: string) =>
        isExecutionTime({
          cronPattern: '30 14 * * *',
          currentTime: utc(time),
          lastExecutedAt: utc(last),
          timezone: 'UTC',
        });
      expect(tick('2026-04-29T14:25:00', '2026-04-28T14:30:00')).toBe(false);
      expect(tick('2026-04-29T14:30:00', '2026-04-28T14:30:00')).toBe(true);
      expect(tick('2026-04-29T14:35:00', '2026-04-29T14:30:05')).toBe(false);
    });

    it('never fires an invalid pattern or timezone', () => {
      for (const [cronPattern, timezone] of [
        ['0 9 * *', 'UTC'],
        ['0 0 9 * * *', 'UTC'],
        ['61 9 * * *', 'UTC'],
        ['0 9 * * *', 'Mars/Base'],
      ] as const) {
        expect(
          isExecutionTime({
            cronPattern,
            currentTime: utc('2026-04-29T09:00:00'),
            lastExecutedAt: null,
            timezone,
          }),
        ).toBe(false);
      }
    });
  });

  describe('validateCronPattern', () => {
    it('previews the next runs in the pattern timezone', () => {
      const result = validateCronPattern('45 11 * * 1-5', 'Asia/Ho_Chi_Minh', {
        from: utc('2026-09-25T05:00:00'),
      });
      expect(result).toEqual({
        nextRuns: [
          utc('2026-09-28T04:45:00'),
          utc('2026-09-29T04:45:00'),
          utc('2026-09-30T04:45:00'),
        ],
        valid: true,
      });
    });

    it('previews a one-shot date on its actual date', () => {
      const result = validateCronPattern('0 10 27 9 *', SHANGHAI, {
        count: 1,
        from: utc('2026-09-20T03:15:55'),
      });
      expect(result).toEqual({ nextRuns: [utc('2026-09-27T02:00:00')], valid: true });
    });

    it.each([
      ['0 9 * *', 'UTC', /expected 5 fields/],
      ['0 0 9 * * *', 'UTC', /expected 5 fields/],
      ['@daily', 'UTC', /expected 5 fields/],
      ['61 9 * * *', 'UTC', /61/],
      ['0 0 30 2 *', 'UTC', /day of month/],
      ['0 9 * * *', 'Mars/Base', /unknown timezone/],
    ])('rejects %s (%s)', (pattern, timezone, error) => {
      const result = validateCronPattern(pattern, timezone);
      expect(result.valid).toBe(false);
      expect(!result.valid && result.error).toMatch(error);
    });
  });

  describe('null / first-run handling', () => {
    it('fires when there is no lastExecutedAt and clock matches', () => {
      expect(
        isExecutionTime({
          cronPattern: '0 21 * * *',
          currentTime: utc('2026-04-29T21:00:00'),
          lastExecutedAt: null,
          timezone: 'UTC',
        }),
      ).toBe(true);
    });
  });
});

describe('isExecutionTime — arming lower bound', () => {
  it('does NOT fire an occurrence that predates arming (09:00 slot, armed 09:05, 09:10 tick)', () => {
    expect(
      isExecutionTime({
        armedAt: utc('2026-04-29T09:05:00'),
        cronPattern: '0 9 * * *',
        currentTime: utc('2026-04-29T09:10:00'),
        lastExecutedAt: null,
        timezone: 'UTC',
      }),
    ).toBe(false);
  });

  it('does NOT replay the slot just before a re-arm when the last run is older', () => {
    expect(
      isExecutionTime({
        armedAt: utc('2026-04-29T09:05:00'),
        cronPattern: '0 9 * * *',
        currentTime: utc('2026-04-29T09:10:00'),
        lastExecutedAt: utc('2026-04-27T09:00:00'),
        timezone: 'UTC',
      }),
    ).toBe(false);
  });

  it('fires the first occurrence after arming', () => {
    expect(
      isExecutionTime({
        armedAt: utc('2026-04-29T08:55:00'),
        cronPattern: '0 9 * * *',
        currentTime: utc('2026-04-29T09:00:00'),
        lastExecutedAt: null,
        timezone: 'UTC',
      }),
    ).toBe(true);
  });

  it('fires the next day once the armed slot has passed', () => {
    expect(
      isExecutionTime({
        armedAt: utc('2026-04-29T09:05:00'),
        cronPattern: '0 9 * * *',
        currentTime: utc('2026-04-30T09:00:00'),
        lastExecutedAt: null,
        timezone: 'UTC',
      }),
    ).toBe(true);
  });
});

describe('isExecutionTime — grace window vs the 10-minute dispatcher', () => {
  it('still fires a 09:01 occurrence on the 09:20 tick when the 09:10 tick was missed', () => {
    expect(
      isExecutionTime({
        cronPattern: '1 9 * * *',
        currentTime: utc('2026-04-29T09:20:00'),
        lastExecutedAt: utc('2026-04-28T09:10:00'),
        timezone: 'UTC',
      }),
    ).toBe(true);
  });

  it('covers one missed tick plus jitter: a 09:01 occurrence on a late 09:20 tick (09:25)', () => {
    expect(
      isExecutionTime({
        cronPattern: '1 9 * * *',
        currentTime: utc('2026-04-29T09:25:00'),
        lastExecutedAt: utc('2026-04-28T09:10:00'),
        timezone: 'UTC',
      }),
    ).toBe(true);
  });

  it('does NOT replay an occurrence older than the grace window', () => {
    expect(
      isExecutionTime({
        cronPattern: '1 9 * * *',
        currentTime: utc('2026-04-29T09:40:00'),
        lastExecutedAt: utc('2026-04-28T09:10:00'),
        timezone: 'UTC',
      }),
    ).toBe(false);
  });
});
