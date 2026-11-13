import { type QuotaDisplayReading } from '@lobechat/heterogeneous-agents/quota';
import { describe, expect, it } from 'vitest';

import { accountLoadOf } from './accountLoad';

const NOW = Date.UTC(2026, 10, 17, 12);
const HOUR = 60 * 60 * 1000;

const reading = (overrides: Partial<QuotaDisplayReading>): QuotaDisplayReading => ({
  capturedAt: NOW - 60_000,
  limitName: null,
  limitType: 'session',
  resetsAt: NOW + 2 * HOUR,
  scopeKey: null,
  utilization: 40,
  windowMinutes: 300,
  ...overrides,
});

describe('accountLoadOf', () => {
  it('shows the share left of the session and weekly windows with the time to reset', () => {
    expect(
      accountLoadOf(
        [
          reading({ limitType: 'session', utilization: 40 }),
          reading({
            limitType: 'weekly_all',
            resetsAt: NOW + 3 * 24 * HOUR,
            utilization: 72.4,
            windowMinutes: 7 * 24 * 60,
          }),
        ],
        NOW,
      ),
    ).toEqual({
      session: { leftPercent: 60, level: 'ok', resetsInMs: 2 * HOUR },
      weekly: { leftPercent: 28, level: 'ok', resetsInMs: 3 * 24 * HOUR },
    });
  });

  it('flags a window running low and one used up', () => {
    const load = accountLoadOf(
      [
        reading({ limitType: 'session', utilization: 100 }),
        reading({ limitType: 'weekly_all', utilization: 90, windowMinutes: 7 * 24 * 60 }),
      ],
      NOW,
    );

    expect(load.session?.level).toBe('exhausted');
    expect(load.weekly).toMatchObject({ leftPercent: 10, level: 'low' });
  });

  it('counts a window that already reset as refilled rather than as its last reading', () => {
    const load = accountLoadOf(
      [reading({ capturedAt: NOW - 6 * HOUR, resetsAt: NOW - HOUR, utilization: 100 })],
      NOW,
    );

    expect(load.session).toEqual({ leftPercent: 100, level: 'ok', resetsInMs: undefined });
  });

  it('has nothing to show for an account without readings', () => {
    expect(accountLoadOf([], NOW)).toEqual({ session: undefined, weekly: undefined });
  });
});
