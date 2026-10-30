import { describe, expect, it } from 'vitest';

import { deriveAccountView, matchesKeyword, sortAccounts } from './accountView';

const NOW = Date.UTC(2026, 9, 24, 12);
const HOUR = 60 * 60 * 1000;

const reading = (limitType: string, utilization: number, resetsAt: number | null, at = NOW) => ({
  capturedAt: at,
  limitType,
  resetsAt,
  scopeKey: '',
  utilization,
});

describe('deriveAccountView', () => {
  it('reports both windows and the newest sync time for an available account', () => {
    const view = deriveAccountView(
      { enabled: true },
      [
        reading('session', 30, NOW + HOUR, NOW - 2 * HOUR),
        reading('weekly_all', 40, NOW + 48 * HOUR),
      ],
      NOW,
    );

    expect(view.status).toBe('available');
    expect(view.session).toEqual({ resetsAt: NOW + HOUR, usedPercent: 30 });
    expect(view.weekly).toEqual({ resetsAt: NOW + 48 * HOUR, usedPercent: 40 });
    expect(view.lastSyncedAt).toBe(NOW);
  });

  it('marks a used-up window as exhausted and recovers at the latest blocking reset', () => {
    const view = deriveAccountView(
      { enabled: true },
      [reading('session', 100, NOW + HOUR), reading('weekly_all', 100, NOW + 24 * HOUR)],
      NOW,
    );

    expect(view.status).toBe('exhausted');
    expect(view.recoversAt).toBe(NOW + 24 * HOUR);
  });

  it('treats a used-up window that already rolled over as refilled', () => {
    const view = deriveAccountView(
      { enabled: true },
      [reading('weekly_all', 100, NOW - HOUR, NOW - 3 * HOUR)],
      NOW,
    );

    expect(view.status).toBe('available');
    expect(view.weekly).toEqual({ resetsAt: null, usedPercent: 0 });
  });

  it('keeps a disabled account disabled whatever its readings say', () => {
    const view = deriveAccountView(
      { enabled: false },
      [reading('weekly_all', 100, NOW + HOUR)],
      NOW,
    );

    expect(view.status).toBe('disabled');
    expect(view.weekly?.usedPercent).toBe(100);
  });

  it('reports no data before the account has any reading', () => {
    expect(deriveAccountView({ enabled: true }, undefined, NOW)).toEqual({
      lastSyncedAt: undefined,
      session: undefined,
      status: 'noData',
      weekly: undefined,
    });
  });
});

describe('sortAccounts', () => {
  it('lists accounts in rotation first, then by provider and name', () => {
    const sorted = sortAccounts([
      { email: 'b@x.com', enabled: true, provider: 'codex' },
      { email: 'z@x.com', enabled: false, provider: 'claude-code' },
      { email: 'c@x.com', enabled: true, provider: 'claude-code' },
      { email: 'a@x.com', enabled: true, label: null, provider: 'claude-code' },
    ]);

    expect(sorted.map((a) => a.email)).toEqual(['a@x.com', 'c@x.com', 'b@x.com', 'z@x.com']);
  });
});

describe('matchesKeyword', () => {
  const account = { email: 'Dev@Example.com', label: 'Team Max', planTier: 'max' };

  it('matches the label, email or plan regardless of case', () => {
    expect(matchesKeyword(account, 'team')).toBe(true);
    expect(matchesKeyword(account, 'dev@example')).toBe(true);
    expect(matchesKeyword(account, 'MAX')).toBe(true);
  });

  it('keeps every account for a blank keyword and drops non-matches', () => {
    expect(matchesKeyword(account, '  ')).toBe(true);
    expect(matchesKeyword(account, 'codex')).toBe(false);
  });
});
