import { describe, expect, it } from 'vitest';

import { getActiveEvalHref } from './getActiveEvalHref';

describe('getActiveEvalHref', () => {
  it('marks the dashboard on /eval', () => {
    expect(getActiveEvalHref('/eval')).toBe('/eval');
    expect(getActiveEvalHref('/eval/')).toBe('/eval');
  });

  it('keeps the benchmark active on its run pages', () => {
    expect(getActiveEvalHref('/eval/bench/evb_1/runs/run_1')).toBe('/eval/bench/evb_1');
  });

  it('matches datasets and experiments', () => {
    expect(getActiveEvalHref('/eval/datasets/ds_1')).toBe('/eval/datasets/ds_1');
    expect(getActiveEvalHref('/eval/experiments/exp_1')).toBe('/eval/experiments/exp_1');
  });

  it('ignores a workspace slug prefix', () => {
    expect(getActiveEvalHref('/acme/eval')).toBe('/eval');
    expect(getActiveEvalHref('/acme/eval/bench/evb_1')).toBe('/eval/bench/evb_1');
  });

  it('has no owner for comparison pages', () => {
    expect(getActiveEvalHref('/eval/comparisons/run_1')).toBeUndefined();
  });
});
