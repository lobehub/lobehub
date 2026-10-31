import type { AntigravityQuotaSnapshot } from '@lobechat/heterogeneous-agents/quota';
import { describe, expect, it } from 'vitest';

import { antigravityQuotaCompact, isAntigravityQuotaStale } from './antigravityQuotaView';

const now = 1_800_000_000_000;
const snapshot: AntigravityQuotaSnapshot = {
  error: null,
  groups: [
    {
      name: 'Models',
      buckets: [
        {
          id: 'model',
          name: 'Quota',
          window: 'weekly',
          disabled: false,
          remainingAmount: null,
          remainingFraction: 0.939,
          resetsAt: now + 1000,
        },
      ],
    },
  ],
  provider: 'antigravity',
  status: 'ok',
  updatedAt: now,
};

describe('Antigravity quota display', () => {
  it('uses the native remaining fraction without substituting a window projection', () => {
    expect(antigravityQuotaCompact(snapshot, now)).toEqual([
      { key: 'antigravity', leftPercent: 93.9 },
    ]);
  });
  it('does not claim an expired snapshot is full or still current', () => {
    expect(isAntigravityQuotaStale(snapshot, now + 1001)).toBe(true);
    expect(antigravityQuotaCompact(snapshot, now + 1001)).toEqual([]);
    expect(snapshot.groups[0].buckets[0].remainingFraction).toBe(0.939);
    expect(antigravityQuotaCompact({ ...snapshot, updatedAt: now - 120_000 }, now)).toEqual([]);
  });
  it('does not round a small positive balance into an exhausted badge', () => {
    const tiny = {
      ...snapshot,
      groups: [
        {
          name: 'Models',
          buckets: [{ ...snapshot.groups[0].buckets[0], remainingFraction: 0.0001 }],
        },
      ],
    };
    expect(antigravityQuotaCompact(tiny, now)[0]).toMatchObject({ label: '<', leftPercent: 0.1 });
  });
  it('excludes disabled and unknown buckets, retaining a genuine zero', () => {
    const bucket = snapshot.groups[0].buckets[0];
    const data = {
      ...snapshot,
      groups: [
        {
          name: 'Models',
          buckets: [
            {
              ...bucket,
              id: 'disabled',
              disabled: true,
              remainingFraction: 0,
              resetsAt: now - 1000,
            },
            { ...bucket, id: 'unknown', remainingFraction: null },
            bucket,
          ],
        },
      ],
    };
    expect(antigravityQuotaCompact(data, now)[0].leftPercent).toBe(93.9);
    expect(
      antigravityQuotaCompact(
        {
          ...snapshot,
          groups: [{ name: 'Models', buckets: [{ ...bucket, remainingFraction: 0 }] }],
        },
        now,
      )[0].leftPercent,
    ).toBe(0);
  });
});
