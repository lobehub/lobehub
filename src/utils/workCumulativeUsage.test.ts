import { describe, expect, it } from 'vitest';

import { buildWorkVersionCumulativeUsage } from './workCumulativeUsage';

describe('buildWorkVersionCumulativeUsage', () => {
  it('returns null snapshots when runtime usage and cost are missing', () => {
    expect(buildWorkVersionCumulativeUsage({})).toEqual({
      cumulativeCost: null,
      cumulativeUsage: null,
    });
  });

  it('projects cumulative cost and usage into a stable Work version shape', () => {
    const snapshot = buildWorkVersionCumulativeUsage({
      cost: {
        calculatedAt: '2026-06-30T08:00:00.000Z',
        currency: 'USD',
        llm: { byModel: [], currency: 'USD', total: 0.02 },
        tools: { byTool: [], currency: 'USD', total: 0.01 },
        total: 0.03,
      },
      now: new Date('2026-06-30T08:01:00.000Z'),
      usage: {
        humanInteraction: {
          approvalRequests: 0,
          promptRequests: 0,
          selectRequests: 0,
          totalWaitingTimeMs: 0,
        },
        llm: {
          apiCalls: 1,
          processingTimeMs: 500,
          tokens: { input: 100, output: 20, total: 120 },
        },
        tools: {
          byTool: [{ calls: 1, errors: 0, name: 'lobe-task/createTask', totalTimeMs: 20 }],
          totalCalls: 1,
          totalTimeMs: 20,
        },
      },
    });

    expect(snapshot).toEqual({
      cumulativeCost: 0.03,
      cumulativeUsage: {
        capturedAt: '2026-06-30T08:01:00.000Z',
        cost: expect.objectContaining({ total: 0.03 }),
        usage: expect.objectContaining({
          llm: expect.objectContaining({ apiCalls: 1 }),
          tools: expect.objectContaining({ totalCalls: 1 }),
        }),
      },
    });
  });
});
