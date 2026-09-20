import { describe, expect, it } from 'vitest';

import { buildKimiCodePanelSnapshot } from './kimiCodeQuotaViewModel';

const now = 1_800_000_000_000;
const account = { externalAccountId: 'a', updatedAt: new Date(now) };
const reading = {
  capturedAt: now,
  limitType: 'session',
  resetsAt: now + 60000,
  scopeKey: '',
  utilization: 23,
  windowMinutes: 300,
};
const live = {
  error: null,
  extraUsage: null,
  identity: { externalAccountId: 'b' },
  monthly: null,
  monthlyCode: null,
  provider: 'kimi-code' as const,
  readings: [{ ...reading, capturedAt: now + 1, utilization: 90 }],
  session: null,
  status: 'ok' as const,
  updatedAt: now + 1,
  weekly: null,
};

describe('Kimi Code account view', () => {
  it('never merges quota from another account', () => {
    expect(buildKimiCodePanelSnapshot(account, [reading], live, now).session?.usedPercent).toBe(23);
  });
  it('merges newer live buckets only for the same account', () => {
    expect(
      buildKimiCodePanelSnapshot(
        account,
        [reading],
        { ...live, identity: { externalAccountId: 'a' } },
        now,
      ).session?.usedPercent,
    ).toBe(90);
  });
  it('preserves persisted windows after a failed refresh', () => {
    expect(
      buildKimiCodePanelSnapshot(account, [reading], { ...live, status: 'error' }, now).session
        ?.usedPercent,
    ).toBe(23);
  });
  it('carries the Extra Usage balance only from a same-account live sample', () => {
    const extraUsage = {
      balanceCents: 1234,
      currency: 'USD',
      monthlyChargeLimitCents: 5000,
      monthlyChargeLimitEnabled: true,
      monthlyUsedCents: 42,
      totalCents: 2000,
    };
    expect(
      buildKimiCodePanelSnapshot(account, [reading], { ...live, extraUsage }, now).extraUsage,
    ).toBeNull();
    expect(
      buildKimiCodePanelSnapshot(
        account,
        [reading],
        { ...live, extraUsage, identity: { externalAccountId: 'a' } },
        now,
      ).extraUsage,
    ).toEqual(extraUsage);
  });
  it('rebuilds all four windows from persisted readings', () => {
    const readings = [
      reading,
      { ...reading, limitType: 'weekly_all', utilization: 40, windowMinutes: 10_080 },
      { ...reading, limitType: 'month_total', utilization: 55, windowMinutes: 43_200 },
      { ...reading, limitType: 'month_code', utilization: 61, windowMinutes: 43_200 },
    ];
    const snapshot = buildKimiCodePanelSnapshot(account, readings, null, now);
    expect(snapshot.session?.usedPercent).toBe(23);
    expect(snapshot.weekly?.usedPercent).toBe(40);
    expect(snapshot.monthly?.usedPercent).toBe(55);
    expect(snapshot.monthlyCode?.usedPercent).toBe(61);
  });
});
