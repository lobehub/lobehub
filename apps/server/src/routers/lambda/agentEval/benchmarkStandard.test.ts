import { describe, expect, it } from 'vitest';

import {
  assertNewBenchmarkStandard,
  assertRunFollowsBenchmark,
  benchmarkProtocolOf,
  keepBenchmarkStandard,
} from './benchmarkStandard';

const judge = { model: 'gemini-3.8-flash', provider: 'google' };
const protocol = { k: 3, maxSteps: 30, timeoutMinutes: 20 };
const lobeBench = { judge, kind: 'lobe-bench', protocol };

describe('Lobe Bench benchmark standard', () => {
  it('requires a judge and run rules when a Lobe Bench benchmark is made, not an Evaluation Lab one', () => {
    expect(() => assertNewBenchmarkStandard({ kind: 'lobe-bench', protocol })).toThrow(
      'judge model',
    );
    expect(() => assertNewBenchmarkStandard({ judge, kind: 'lobe-bench' })).toThrow('run rules');
    expect(() =>
      assertNewBenchmarkStandard({ ...lobeBench, protocol: { ...protocol, k: 9 } }),
    ).toThrow();
    expect(() => assertNewBenchmarkStandard(lobeBench)).not.toThrow();
    expect(() => assertNewBenchmarkStandard({})).not.toThrow();
    expect(() => assertNewBenchmarkStandard(undefined)).not.toThrow();
  });

  it('keeps the judge and run rules through any update', () => {
    expect(
      keepBenchmarkStandard(
        {
          judge: { model: 'other', provider: 'openrouter' },
          kind: 'lobe-bench',
          protocol: { k: 1, maxSteps: 80, timeoutMinutes: 60 },
        },
        lobeBench,
      ),
    ).toEqual(lobeBench);
    expect(keepBenchmarkStandard({ kind: 'lobe-bench', name: 'x' }, lobeBench)).toEqual({
      ...lobeBench,
      name: 'x',
    });
  });

  it('lets a benchmark made before the rules were fixed set them once', () => {
    expect(keepBenchmarkStandard(lobeBench, { kind: 'lobe-bench' })).toEqual(lobeBench);
    expect(() =>
      keepBenchmarkStandard({ kind: 'lobe-bench', protocol: { k: 0 } }, { kind: 'lobe-bench' }),
    ).toThrow('run rules');
    expect(keepBenchmarkStandard({ name: 'x' }, { name: 'lab' })).toEqual({ name: 'x' });
  });

  it('reads older benchmarks’ complete defaults as their rules', () => {
    expect(benchmarkProtocolOf({ defaults: protocol, kind: 'lobe-bench' })).toEqual(protocol);
    expect(benchmarkProtocolOf({ defaults: { k: 3 }, kind: 'lobe-bench' })).toBeUndefined();
  });

  it('refuses a run that does not follow the benchmark’s judge and rules', () => {
    const follows = {
      judgeModel: judge.model,
      judgeProvider: judge.provider,
      k: 3,
      maxSteps: 30,
      timeout: 20 * 60_000,
    };
    expect(() => assertRunFollowsBenchmark(follows, lobeBench)).not.toThrow();
    for (const change of [
      { k: 1 },
      { maxSteps: 80 },
      { timeout: 60 * 60_000 },
      { judgeModel: 'other' },
      { judgeModel: undefined, judgeProvider: undefined },
    ])
      expect(() => assertRunFollowsBenchmark({ ...follows, ...change }, lobeBench)).toThrow(
        "benchmark's judge",
      );
    expect(() => assertRunFollowsBenchmark({ k: 1 }, { name: 'lab' })).not.toThrow();
  });
});
