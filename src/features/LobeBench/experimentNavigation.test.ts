import { describe, expect, it } from 'vitest';

import {
  benchmarkDatasetPath,
  benchmarkHomePath,
  benchmarkSidebarBackPath,
  experimentContextSuffix,
  newExperimentPath,
  parseExperimentId,
  runBackPath,
} from './experimentNavigation';

describe('experiment case navigation', () => {
  it('keeps a generated experiment id in the previous/next case context', () => {
    const id = parseExperimentId('exp_aB09_-cdEF12');
    expect(id).toBe('exp_aB09_-cdEF12');
    expect(experimentContextSuffix(id)).toBe('?experiment=exp_aB09_-cdEF12');
  });

  it.each(['custom-experiment_42', 'exp_', 'A1'])(
    'preserves a safe caller-supplied id %s',
    (value) => {
      expect(parseExperimentId(value)).toBe(value);
      expect(new URLSearchParams(experimentContextSuffix(value)).get('experiment')).toBe(value);
    },
  );

  it('encodes query metacharacters when building a case link', () => {
    const suffix = experimentContextSuffix('custom&tab=setup');
    expect(new URLSearchParams(suffix).get('experiment')).toBe('custom&tab=setup');
    expect(new URLSearchParams(suffix).has('tab')).toBe(false);
  });

  it.each([
    null,
    '',
    ' ',
    'https://external.example',
    '//external.example',
    '../../../../settings',
    'exp_../settings',
    'exp_value&tab=setup',
    'exp_value?other=1',
    'exp_value#anchor',
    'exp_value/another',
    'exp_value\\another',
    'exp_%2e%2e',
  ])('drops invalid experiment context %j', (value) => {
    const id = parseExperimentId(value);
    expect(id).toBeUndefined();
    expect(experimentContextSuffix(id)).toBe('');
  });
});

describe('back navigation from the Lab run page', () => {
  it('returns a Lobe Bench run to the experiment it was started from', () => {
    expect(runBackPath({ benchmarkId: 'evb_1', experimentId: 'exp_9', lobeBench: true })).toBe(
      '/eval/lobe-bench/experiments/exp_9',
    );
  });

  it('returns a Lobe Bench run without an experiment to its Lobe Bench benchmark', () => {
    expect(runBackPath({ benchmarkId: 'evb_1', experimentId: null, lobeBench: true })).toBe(
      '/eval/lobe-bench/benchmarks/evb_1',
    );
    expect(runBackPath({ benchmarkId: 'evb_1', experimentId: '../x', lobeBench: true })).toBe(
      '/eval/lobe-bench/benchmarks/evb_1',
    );
  });

  it('keeps an Evaluation Lab run in the Lab, even when it has an experiment', () => {
    expect(runBackPath({ benchmarkId: 'b1', experimentId: 'exp_9', lobeBench: false })).toBe(
      '/eval/bench/b1',
    );
  });

  it('points the sidebar back arrow and benchmark name at the same side', () => {
    expect(benchmarkSidebarBackPath('evb_1', true)).toBe('/eval/lobe-bench/benchmarks/evb_1');
    expect(benchmarkSidebarBackPath('b1', false)).toBe('/eval');
    expect(benchmarkHomePath('evb_1', true)).toBe('/eval/lobe-bench/benchmarks/evb_1');
    expect(benchmarkHomePath('b1', false)).toBe('/eval/bench/b1');
  });

  it("opens a benchmark sidebar's dataset on the benchmark's own side", () => {
    expect(benchmarkDatasetPath('ds_1', true)).toBe('/eval/lobe-bench/datasets/ds_1');
    expect(benchmarkDatasetPath('ds_1', false)).toBe('/eval/datasets/ds_1');
  });
});

describe('newExperimentPath', () => {
  it('opens the new experiment page on the named dataset', () => {
    expect(newExperimentPath('ds_ZEmC8pJFtXVs')).toBe(
      '/eval/lobe-bench/experiments/new?dataset=ds_ZEmC8pJFtXVs',
    );
  });

  it('encodes the id and opens the plain page without one', () => {
    expect(newExperimentPath('a&b')).toBe('/eval/lobe-bench/experiments/new?dataset=a%26b');
    expect(newExperimentPath(undefined)).toBe('/eval/lobe-bench/experiments/new');
    expect(newExperimentPath(null)).toBe('/eval/lobe-bench/experiments/new');
  });
});
