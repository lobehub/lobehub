import { describe, expect, it } from 'vitest';

import { renderReport } from './report';
import type { CheckResult, DoctorReport } from './types';

const result = (overrides: Partial<CheckResult>): CheckResult => ({
  detail: 'detail',
  durationMs: 1,
  group: 'runtime',
  id: 'runtime.node',
  status: 'ok',
  title: 'node runtime',
  ...overrides,
});

const report = (checks: CheckResult[]): DoctorReport => ({
  checks,
  cli: { bin: 'lh', version: '0.0.55' },
  generatedAt: '2026-09-16T00:00:00.000Z',
  profile: 'core',
  status: checks.some((c) => c.status === 'fail') ? 'fail' : 'ok',
  summary: {
    fail: checks.filter((c) => c.status === 'fail').length,
    ok: checks.filter((c) => c.status === 'ok').length,
    skip: checks.filter((c) => c.status === 'skip').length,
    warn: checks.filter((c) => c.status === 'warn').length,
  },
});

describe('renderReport', () => {
  it('groups checks and shows the fix only for findings', () => {
    const output = renderReport(
      report([
        result({ fix: 'not shown', status: 'ok' }),
        result({
          detail: 'broken',
          fix: 'do this',
          group: 'endpoints',
          id: 'endpoints.resolution',
          status: 'fail',
          title: 'endpoint resolution',
        }),
      ]),
    );

    expect(output).toContain('Runtime');
    expect(output).toContain('Endpoints');
    expect(output).toContain('do this');
    expect(output).not.toContain('not shown');
  });

  it('hides evidence unless verbose', () => {
    const checks = [result({ evidence: { nodeVersion: 'v24.3.0' } })];

    expect(renderReport(report(checks))).not.toContain('nodeVersion');
    expect(renderReport(report(checks), { verbose: true })).toContain('nodeVersion: v24.3.0');
  });

  it('names what a repair changed', () => {
    expect(renderReport(report([result({ repaired: 'cleared the stale scope' })]))).toContain(
      'cleared the stale scope',
    );
  });

  it('counts every status in the footer', () => {
    const output = renderReport(
      report([
        result({}),
        result({ id: 'b', status: 'warn' }),
        result({ id: 'c', status: 'skip' }),
      ]),
    );

    expect(output).toContain('1 ok');
    expect(output).toContain('1 warning');
    expect(output).toContain('1 skipped');
  });
});
