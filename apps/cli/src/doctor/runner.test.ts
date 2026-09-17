import { describe, expect, it, vi } from 'vitest';

import { exitCodeFor, runDoctor } from './runner';
import type { CheckOutcome, DoctorCheck, DoctorOptions, DoctorReport } from './types';

const baseOptions: DoctorOptions = {
  deep: false,
  fix: false,
  offline: false,
  profile: 'core',
  strict: false,
  timeoutMs: 1000,
};

const check = (
  id: string,
  outcome: CheckOutcome,
  extra: Partial<DoctorCheck> = {},
): DoctorCheck => ({
  group: 'runtime',
  id,
  profiles: ['core'],
  run: () => outcome,
  title: id,
  ...extra,
});

const ok: CheckOutcome = { detail: 'fine', status: 'ok' };
const fail: CheckOutcome = { detail: 'broken', status: 'fail' };

describe('runDoctor', () => {
  it('skips checks whose dependency failed, instead of reporting their symptoms', async () => {
    const downstream = vi.fn(() => ok);
    const report = await runDoctor(
      [check('root', fail), check('leaf', ok, { dependsOn: ['root'], run: downstream })],
      baseOptions,
    );

    expect(downstream).not.toHaveBeenCalled();
    const leaf = report.checks.find((result) => result.id === 'leaf');
    expect(leaf?.status).toBe('skip');
    expect(leaf?.skippedBecause).toBe('root');
  });

  it('still runs checks whose dependency only warned', async () => {
    const report = await runDoctor(
      [
        check('root', { detail: 'meh', status: 'warn' }),
        check('leaf', ok, { dependsOn: ['root'] }),
      ],
      baseOptions,
    );

    expect(report.checks.find((result) => result.id === 'leaf')?.status).toBe('ok');
  });

  it('skips network checks in offline mode and deep checks without --deep', async () => {
    const report = await runDoctor(
      [check('net', ok, { network: true }), check('slow', ok, { deep: true })],
      { ...baseOptions, offline: true },
    );

    expect(report.checks.map((result) => [result.id, result.skippedBecause])).toEqual([
      ['net', '--offline'],
      ['slow', '--deep not set'],
    ]);
  });

  it('selects checks by profile, with core always included', async () => {
    const report = await runDoctor(
      [
        check('core-one', ok),
        check('connect-one', ok, { profiles: ['connect'] }),
        check('agent-one', ok, { profiles: ['agent'] }),
      ],
      { ...baseOptions, profile: 'connect' },
    );

    expect(report.checks.map((result) => result.id)).toEqual(['core-one', 'connect-one']);
  });

  it('turns a thrown check into a failure rather than crashing the run', async () => {
    const report = await runDoctor(
      [
        check('boom', ok, {
          run: () => {
            throw new Error('exploded');
          },
        }),
        check('after', ok),
      ],
      baseOptions,
    );

    expect(report.checks[0]).toMatchObject({ detail: 'exploded', status: 'fail' });
    expect(report.checks[1]?.status).toBe('ok');
  });

  it('gives a check its own budget when it declares one', async () => {
    const report = await runDoctor(
      [
        check('slow', ok, {
          budgetMs: () => 50,
          run: () => new Promise<CheckOutcome>((resolve) => setTimeout(() => resolve(ok), 500)),
        }),
      ],
      baseOptions,
    );

    expect(report.checks[0]?.status).toBe('fail');
    expect(report.checks[0]?.detail).toContain('timed out after 50ms');
  });

  it('memoizes a probe across checks', async () => {
    const load = vi.fn(async () => 'value');
    const useProbe = (): DoctorCheck['run'] => async (ctx) => {
      await ctx.probe('shared', load);
      return ok;
    };

    await runDoctor(
      [check('a', ok, { run: useProbe() }), check('b', ok, { run: useProbe() })],
      baseOptions,
    );

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('re-runs a check after its repair so the report shows the repaired state', async () => {
    let broken = true;
    const report = await runDoctor(
      [
        check('fixable', ok, {
          repair: () => {
            broken = false;
            return 'unbroke it';
          },
          run: () => (broken ? { ...fail, evidence: { repairable: 'the-thing' } } : ok),
        }),
      ],
      { ...baseOptions, fix: true },
    );

    expect(report.checks[0]).toMatchObject({ repaired: 'unbroke it', status: 'ok' });
    expect(report.repairs).toEqual([{ action: 'unbroke it', id: 'fixable', ok: true }]);
  });

  it('records a repair that threw without losing the original finding', async () => {
    const report = await runDoctor(
      [
        check(
          'fixable',
          { ...fail, evidence: { repairable: 'the-thing' } },
          {
            repair: () => {
              throw new Error('permission denied');
            },
          },
        ),
      ],
      { ...baseOptions, fix: true },
    );

    expect(report.checks[0]?.status).toBe('fail');
    expect(report.repairs).toEqual([{ action: 'permission denied', id: 'fixable', ok: false }]);
  });

  it('leaves repairs alone without --fix', async () => {
    const repair = vi.fn(() => 'nope');
    const report = await runDoctor([check('fixable', fail, { repair })], baseOptions);

    expect(repair).not.toHaveBeenCalled();
    expect(report.repairs).toBeUndefined();
  });

  it('does not invoke a repair for a finding the check did not call repairable', async () => {
    // Otherwise `--fix` reports a failed repair for every warning that simply
    // has nothing to undo, e.g. "no daemon is running".
    const repair = vi.fn(() => 'nope');
    const report = await runDoctor([check('unfixable', fail, { repair })], {
      ...baseOptions,
      fix: true,
    });

    expect(repair).not.toHaveBeenCalled();
    expect(report.repairs).toBeUndefined();
    expect(report.checks[0]?.status).toBe('fail');
  });

  it('summarises and ranks the overall status by the worst result', async () => {
    const report = await runDoctor(
      [check('a', ok), check('b', { detail: '', status: 'warn' }), check('c', fail)],
      baseOptions,
    );

    expect(report.summary).toEqual({ fail: 1, ok: 1, skip: 0, warn: 1 });
    expect(report.status).toBe('fail');
  });
});

describe('runDoctor report boundary', () => {
  it('scrubs whatever a check forgot to redact', async () => {
    const report = await runDoctor(
      [
        check('leaky', {
          detail: 'GET https://alice:hunter2@lobe.internal failed',
          evidence: { agentGatewayUrl: 'wss://bob:pw@gw.internal/ws?userId=u1' },
          fix: 'mail admin@example.com',
          status: 'fail',
        }),
      ],
      baseOptions,
    );

    expect(JSON.stringify(report)).not.toMatch(/hunter2|bob:pw|userId=u1|admin@example\.com/);
  });
});

describe('exitCodeFor', () => {
  const report = (status: DoctorReport['status']): DoctorReport => ({
    checks: [],
    cli: { bin: 'lh', version: '0.0.0' },
    generatedAt: '',
    profile: 'core',
    status,
    summary: { fail: 0, ok: 0, skip: 0, warn: 0 },
  });

  it('is 0 when nothing failed', () => {
    expect(exitCodeFor(report('ok'), false)).toBe(0);
    expect(exitCodeFor(report('warn'), false)).toBe(0);
  });

  it('is 1 on failure, and on warnings under --strict', () => {
    expect(exitCodeFor(report('fail'), false)).toBe(1);
    expect(exitCodeFor(report('warn'), true)).toBe(1);
    expect(exitCodeFor(report('ok'), true)).toBe(0);
  });
});
