import type { AgentEvalRunListItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  getRecentPassRate,
  getRunHref,
  getRunModels,
  getRunPassRate,
  sortRunsNewestFirst,
} from './runHelpers';

const run = (patch: Partial<AgentEvalRunListItem>): AgentEvalRunListItem => ({
  createdAt: new Date('2026-01-01'),
  datasetId: 'ds_1',
  id: 'run_1',
  status: 'completed',
  updatedAt: new Date('2026-01-01'),
  ...patch,
});

describe('getRunHref', () => {
  const map = new Map([['ds_1', 'evb_1']]);

  it('links comparisons to the comparison page', () => {
    expect(getRunHref(run({ config: { executionMode: 'replay' } }), map)).toBe(
      '/eval/comparisons/run_1',
    );
  });

  it('links a run under its dataset benchmark', () => {
    expect(getRunHref(run({}), map)).toBe('/eval/bench/evb_1/runs/run_1');
  });

  it('falls back to the dataset when the benchmark is unknown', () => {
    expect(getRunHref(run({ datasetId: 'ds_x' }), map)).toBe('/eval/datasets/ds_x');
  });
});

describe('getRunModels', () => {
  it('lists every replay target of a comparison', () => {
    const models = getRunModels(
      run({
        config: {
          executionMode: 'replay',
          replayTargets: [
            { model: 'a', provider: 'p' },
            { model: 'b', provider: 'q' },
          ],
        },
      }),
    );
    expect(models.map((m) => m.model)).toEqual(['a', 'b']);
  });

  it('uses the subject model override for a regular run', () => {
    expect(getRunModels(run({ config: { subjectModel: 'm', subjectProvider: 'p' } }))).toEqual([
      { model: 'm', provider: 'p' },
    ]);
  });
});

describe('getRunPassRate', () => {
  it('has no rate when every case errored', () => {
    expect(
      getRunPassRate(
        run({ metrics: { errorCases: 3, passRate: 0, totalCases: 3 } as any, status: 'failed' }),
      ),
    ).toBeUndefined();
  });

  it('reports a real 0% when cases were judged', () => {
    expect(
      getRunPassRate(run({ metrics: { errorCases: 0, passRate: 0, totalCases: 3 } as any })),
    ).toBe(0);
  });
});

describe('getRecentPassRate', () => {
  it('is undefined when no run finished with a rate', () => {
    expect(getRecentPassRate([run({ status: 'running' })])).toBeUndefined();
  });

  it('weights each run by its case count', () => {
    const result = getRecentPassRate([
      run({ metrics: { passRate: 1, totalCases: 2 } as any }),
      run({ id: 'r2', metrics: { passRate: 0.5, totalCases: 8 } as any }),
      run({ id: 'r3', status: 'failed', metrics: { passRate: 0 } as any }),
    ]);
    expect(result?.runCount).toBe(2);
    expect(result?.rate).toBeCloseTo(0.6);
  });
});

describe('sortRunsNewestFirst', () => {
  it('orders by createdAt descending', () => {
    const sorted = sortRunsNewestFirst([
      run({ createdAt: new Date('2026-01-01'), id: 'old' }),
      run({ createdAt: new Date('2026-02-01'), id: 'new' }),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(['new', 'old']);
  });
});
