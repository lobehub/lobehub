import type { ChaosRunResult } from '@achaos/core';
import { describe, expect, it } from 'vitest';

import { formatChaosResult } from './reporter';

describe('formatChaosResult', () => {
  it('emits a versioned machine-readable CI result', () => {
    const result = {
      durationMs: 1,
      experimentId: 'test',
      finishedAt: '2026-01-01T00:00:00.001Z',
      injection: {
        adapter: 'database',
        cleanupToken: { password: 'secret', row: { private: true } },
        details: { table: 'operations' },
        injectionId: 'injection',
      },
      oracleResults: [],
      runId: 'run',
      seed: 'seed',
      startedAt: '2026-01-01T00:00:00.000Z',
      status: 'passed',
      timeline: [],
    } as unknown as ChaosRunResult;
    const report = JSON.parse(formatChaosResult(result));
    expect(report).toMatchObject({
      injection: { adapter: 'database', details: { table: 'operations' } },
      schemaVersion: 1,
      status: 'passed',
    });
    expect(report.injection.cleanupToken).toBeUndefined();
    expect(formatChaosResult(result)).not.toContain('secret');
  });

  it('serializes unsupported and cyclic detail values safely', () => {
    const details: Record<string, unknown> = { sequence: 1n };
    details.self = details;
    const result = {
      durationMs: 1,
      experimentId: 'test',
      finishedAt: '2026-01-01T00:00:00.001Z',
      injection: { adapter: 'custom', details, injectionId: 'injection' },
      oracleResults: [],
      runId: 'run',
      seed: 'seed',
      startedAt: '2026-01-01T00:00:00.000Z',
      status: 'passed',
      timeline: [],
    } as unknown as ChaosRunResult;
    expect(() => formatChaosResult(result)).not.toThrow();
    expect(JSON.parse(formatChaosResult(result)).injection.details).toEqual({
      self: '[Circular]',
      sequence: '1n',
    });
  });

  it('preserves repeated non-cyclic objects', () => {
    const shared = { id: 'evidence' };
    const result = {
      durationMs: 1,
      experimentId: 'test',
      finishedAt: '2026-01-01T00:00:00.001Z',
      injection: {
        adapter: 'custom',
        details: { first: shared, second: shared },
        injectionId: 'injection',
      },
      oracleResults: [],
      runId: 'run',
      seed: 'seed',
      startedAt: '2026-01-01T00:00:00.000Z',
      status: 'passed',
      timeline: [],
    } as ChaosRunResult;
    expect(JSON.parse(formatChaosResult(result)).injection.details).toEqual({
      first: { id: 'evidence' },
      second: { id: 'evidence' },
    });
  });
});
