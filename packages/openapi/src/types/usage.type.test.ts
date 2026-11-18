import { describe, expect, it } from 'vitest';

import { getOpenApiUsage } from '@/business/server/openapiUsage';

import { UsageSchema } from './usage.type';

describe('UsageSchema', () => {
  it('accepts the personal and workspace summaries', async () => {
    const personal = await getOpenApiUsage({ userId: 'user-1' });
    const workspace = await getOpenApiUsage({ userId: 'user-1', workspaceId: 'ws-1' });

    expect(UsageSchema.parse(personal).scope).toBe('personal');
    expect(UsageSchema.parse(workspace).scope).toBe('workspace');
  });

  it('accepts a metered quota', () => {
    expect(() =>
      UsageSchema.parse({
        available: true,
        currency: 'USD',
        daily: [{ date: '2026-11-01', value: 1.5 }],
        period: { since: '2026-10-18T00:00:00.000Z', until: '2026-11-17T00:00:00.000Z' },
        quota: {
          limit: 10,
          remaining: 8.5,
          resetsAt: '2026-12-01T00:00:00.000Z',
          source: 'workspace_pool',
          used: 1.5,
          usedRatio: 0.15,
        },
        remainingBalance: 8.5,
        scope: 'workspace',
        spent: 1.5,
        usageByType: [{ count: 3, spend: 1.5, type: 'chat' }],
      }),
    ).not.toThrow();
  });
});
