import { describe, expect, it } from 'vitest';

import { buildCodexPanelSnapshot } from './codexQuotaViewModel';

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
  credits: { balance: '1250.75', unlimited: false },
  error: null,
  identity: { externalAccountId: 'b' },
  provider: 'codex' as const,
  readings: [{ ...reading, capturedAt: now + 1, utilization: 90 }],
  session: null,
  status: 'ok' as const,
  updatedAt: now + 1,
  weekly: null,
};

describe('Codex account view', () => {
  it('never merges quota from another account', () => {
    const result = buildCodexPanelSnapshot(account, [reading], live, now);
    expect(result.session?.usedPercent).toBe(23);
    expect(result.credits).toBeUndefined();
  });
  it('merges newer live buckets and credits only for the same account', () => {
    const result = buildCodexPanelSnapshot(
      account,
      [reading],
      { ...live, identity: { externalAccountId: 'a' } },
      now,
    );
    expect(result.session?.usedPercent).toBe(90);
    expect(result.credits).toEqual(live.credits);
  });
  it('preserves persisted windows after a failed refresh', () => {
    expect(
      buildCodexPanelSnapshot(account, [reading], { ...live, status: 'error' }, now).session
        ?.usedPercent,
    ).toBe(23);
  });
});
