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
    expect(buildCodexPanelSnapshot(account, [reading], live, now).session?.usedPercent).toBe(23);
  });
  it('merges newer live buckets only for the same account', () => {
    expect(
      buildCodexPanelSnapshot(
        account,
        [reading],
        { ...live, identity: { externalAccountId: 'a' } },
        now,
      ).session?.usedPercent,
    ).toBe(90);
  });
  it('preserves persisted windows after a failed refresh', () => {
    expect(
      buildCodexPanelSnapshot(account, [reading], { ...live, status: 'error' }, now).session
        ?.usedPercent,
    ).toBe(23);
  });
});
