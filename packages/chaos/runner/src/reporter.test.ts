import type { ChaosRunResult } from '@chaos/core';
import { describe, expect, it } from 'vitest';

import { formatChaosResult } from './reporter';

describe('formatChaosResult', () => {
  it('emits a versioned machine-readable CI result', () => {
    const result: ChaosRunResult = {
      durationMs: 1,
      experimentId: 'test',
      finishedAt: '2026-01-01T00:00:00.001Z',
      oracleResults: [],
      runId: 'run',
      seed: 'seed',
      startedAt: '2026-01-01T00:00:00.000Z',
      status: 'passed',
      timeline: [],
    };
    expect(JSON.parse(formatChaosResult(result))).toMatchObject({
      schemaVersion: 1,
      status: 'passed',
    });
  });
});
