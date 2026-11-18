import dayjs from 'dayjs';
import { describe, expect, it } from 'vitest';

import type { AccountView } from './accountView';
import {
  accountWindows,
  axisMidnights,
  buildQuotaAxis,
  isUsableAt,
  resetDayOf,
  summarizeQuota,
  teamBuckets,
  WINDOW_MS,
} from './quotaWindows';

// Local 11:00, so midnights fall on local days whatever the test TZ.
const NOW = dayjs('2026-11-10T11:00:00').valueOf();
const HOUR = 60 * 60 * 1000;
const axis = buildQuotaAxis(NOW);

const view = (patch: Partial<AccountView>): AccountView => ({ status: 'available', ...patch });

describe('buildQuotaAxis', () => {
  it('starts one window back and looks seven days ahead', () => {
    expect(axis).toEqual({ end: NOW + 7 * 24 * HOUR, start: NOW - 5 * HOUR });
  });

  it('marks each local midnight inside the axis', () => {
    const midnights = axisMidnights(axis);

    expect(midnights).toHaveLength(7);
    expect(dayjs(midnights[0]).format('YYYY-MM-DD HH:mm')).toBe('2026-11-11 00:00');
  });
});

describe('accountWindows', () => {
  it('places the window under way at its real reset, then lays 5-hour windows back to back', () => {
    const windows = accountWindows(
      view({ session: { resetsAt: NOW + 2 * HOUR, usedPercent: 35 } }),
      axis,
      NOW,
    );

    expect(windows[0]).toEqual({
      blockedBy: undefined,
      end: NOW + 2 * HOUR,
      start: NOW - 3 * HOUR,
      state: 'used',
      tightBy: undefined,
      usedPercent: 35,
    });
    expect(windows[1]).toMatchObject({ end: NOW + 7 * HOUR, start: NOW + 2 * HOUR, state: 'idle' });
    expect(windows.every((w, i) => i === 0 || w.start === windows[i - 1].end)).toBe(true);
    expect(windows.at(-1)!.start).toBeLessThan(axis.end);
    expect(windows.at(-1)!.end).toBeGreaterThanOrEqual(axis.end);
  });

  it('starts from now when no window is under way', () => {
    const windows = accountWindows(
      view({ session: { resetsAt: null, usedPercent: 0 } }),
      axis,
      NOW,
    );

    expect(windows[0]).toMatchObject({ start: NOW, state: 'idle' });
  });

  it('blocks a used-up session window and leaves the next one idle', () => {
    const windows = accountWindows(
      view({ session: { resetsAt: NOW + HOUR, usedPercent: 100 }, status: 'exhausted' }),
      axis,
      NOW,
    );

    expect(windows[0]).toMatchObject({
      blockedBy: { key: 'session', until: NOW + HOUR, usedPercent: 100 },
      state: 'blocked',
    });
    expect(windows[1]).toMatchObject({ blockedBy: undefined, state: 'idle' });
    expect(isUsableAt(windows, NOW)).toBe(false);
    expect(isUsableAt(windows, NOW + 2 * HOUR)).toBe(true);
  });

  it('blocks every window that starts before a used-up weekly limit resets', () => {
    const windows = accountWindows(
      view({
        session: { resetsAt: NOW + HOUR, usedPercent: 20 },
        status: 'exhausted',
        weekly: { resetsAt: NOW + 12 * HOUR, usedPercent: 100 },
      }),
      axis,
      NOW,
    );

    // Starts at -4h, +1h, +6h are before the +12h reset; +11h too; +16h is after.
    expect(windows.slice(0, 4).map((w) => w.state)).toEqual([
      'blocked',
      'blocked',
      'blocked',
      'blocked',
    ]);
    expect(windows[0].blockedBy?.key).toBe('weekly');
    expect(windows[4]).toMatchObject({ start: NOW + 16 * HOUR, state: 'idle' });
  });

  it('keeps a used-up limit with no reported reset, bounded by its latest reset', () => {
    // Kimi-style reading: 100% used, no reset time, still within its window.
    const session = accountWindows(
      view({
        session: { latestResetAt: NOW + 2 * HOUR, resetsAt: null, usedPercent: 100 },
        status: 'exhausted',
      }),
      axis,
      NOW,
    );
    expect(session[0]).toMatchObject({
      blockedBy: { estimated: true, key: 'session', until: NOW + 2 * HOUR },
      start: NOW - 3 * HOUR,
      state: 'blocked',
    });
    expect(isUsableAt(session, NOW)).toBe(false);
    expect(session[1]).toMatchObject({ start: NOW + 2 * HOUR, state: 'idle' });

    const weekly = accountWindows(
      view({
        status: 'exhausted',
        weekly: { latestResetAt: NOW + 12 * HOUR, resetsAt: null, usedPercent: 100 },
      }),
      axis,
      NOW,
    );
    expect(weekly.filter((w) => w.state === 'blocked').map((w) => w.start)).toEqual([
      NOW,
      NOW + 5 * HOUR,
      NOW + 10 * HOUR,
    ]);
    expect(weekly[0].blockedBy?.estimated).toBe(true);
  });

  it('flags a nearly used-up window, and every window a tight weekly limit covers', () => {
    const session = accountWindows(
      view({ session: { resetsAt: NOW + HOUR, usedPercent: 85 } }),
      axis,
      NOW,
    );
    expect(session[0]).toMatchObject({ state: 'used', tightBy: { key: 'session' } });
    expect(session[1].tightBy).toBeUndefined();

    const weekly = accountWindows(
      view({
        session: { resetsAt: NOW + HOUR, usedPercent: 30 },
        weekly: { resetsAt: NOW + 5 * HOUR, usedPercent: 88 },
      }),
      axis,
      NOW,
    );
    expect(weekly.slice(0, 3).map((w) => w.tightBy?.key)).toEqual(['weekly', 'weekly', undefined]);
  });
});

describe('teamBuckets', () => {
  it('cuts the axis ahead of now into 5-hour buckets', () => {
    const buckets = teamBuckets(NOW, axis);

    expect(buckets[0]).toEqual({ end: NOW + WINDOW_MS, start: NOW });
    expect(buckets).toHaveLength(Math.ceil((7 * 24) / 5));
  });
});

describe('summarizeQuota', () => {
  it('counts accounts in rotation and finds the soonest reset and recovery', () => {
    const summary = summarizeQuota(
      [
        view({ session: { resetsAt: NOW + 3 * HOUR, usedPercent: 20 } }),
        view({
          recoversAt: NOW + 5 * HOUR,
          session: { resetsAt: NOW + 5 * HOUR, usedPercent: 100 },
          status: 'exhausted',
        }),
        view({ session: { resetsAt: NOW + HOUR, usedPercent: 10 }, status: 'disabled' }),
        view({ status: 'noData' }),
      ],
      NOW,
    );

    expect(summary).toEqual({
      available: 1,
      exhausted: 1,
      nextRecoveryAt: NOW + 5 * HOUR,
      nextResetAt: NOW + 3 * HOUR,
    });
  });
});

describe('resetDayOf', () => {
  it('words a time by the local day it falls on', () => {
    expect(resetDayOf(NOW + 12 * HOUR, NOW)).toBe('today');
    expect(resetDayOf(NOW + 14 * HOUR, NOW)).toBe('tomorrow');
    expect(resetDayOf(NOW + 40 * HOUR, NOW)).toBe('later');
  });
});
