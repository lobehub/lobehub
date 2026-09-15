import type { ChaosRunResult } from '@achaos/core';
import { describe, expect, it, vi } from 'vitest';

import { recordChaosResult } from '.';

describe('recordChaosResult', () => {
  it('includes scalar timeline data in trace event attributes', () => {
    const addEvent = vi.fn();
    recordChaosResult({ addEvent, setAttribute: vi.fn() }, {
      durationMs: 1,
      experimentId: 'experiment',
      finishedAt: '2026-01-01T00:00:00.001Z',
      oracleResults: [],
      runId: 'run',
      seed: 'seed',
      startedAt: '2026-01-01T00:00:00.000Z',
      status: 'failed',
      timeline: [
        {
          at: '2026-01-01T00:00:00.001Z',
          data: { details: { ignored: true }, name: 'health', status: 'failed' },
          type: 'oracle_evaluated',
        },
      ],
    } satisfies ChaosRunResult);
    expect(addEvent).toHaveBeenCalledWith(
      'chaos.oracle_evaluated',
      expect.objectContaining({
        'chaos.event.data.name': 'health',
        'chaos.event.data.status': 'failed',
      }),
    );
  });
});
