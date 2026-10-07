import type { AgentEvalRunListItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { getRunPassRate, groupRuns } from './groupRuns';
import { getRunModel } from './runModel';

const run = (over: Partial<AgentEvalRunListItem>): AgentEvalRunListItem =>
  ({
    createdAt: new Date('2026-10-01'),
    datasetId: 'ds_a',
    id: 'run',
    status: 'completed',
    targetAgentId: 'agt_1',
    updatedAt: new Date('2026-10-01'),
    ...over,
  }) as AgentEvalRunListItem;

const metrics = (passed: number, failed: number) =>
  ({
    errorCases: 0,
    failedCases: failed,
    passRate: passed / (passed + failed),
    passedCases: passed,
  }) as any;

describe('getRunModel', () => {
  it('prefers the subject model over the snapshot and the agent', () => {
    expect(
      getRunModel(
        run({
          config: {
            agentSnapshot: { model: 'snap', provider: 'p1' },
            subjectModel: 'subject',
            subjectProvider: 'p2',
          },
          targetAgent: { id: 'agt_1', model: 'agent', provider: 'p3' },
        }),
      ),
    ).toEqual({ model: 'subject', provider: 'p2' });
  });

  it('falls back to the snapshot, then the agent', () => {
    expect(
      getRunModel(run({ config: { agentSnapshot: { model: 'snap', provider: 'p1' } } })),
    ).toEqual({ model: 'snap', provider: 'p1' });
    expect(getRunModel(run({ targetAgent: { id: 'a', model: 'agent', provider: 'p3' } }))).toEqual({
      model: 'agent',
      provider: 'p3',
    });
    expect(getRunModel(run({}))).toBeUndefined();
  });
});

describe('groupRuns', () => {
  it('groups by dataset × agent and puts the best pass rate first', () => {
    const groups = groupRuns([
      run({ id: 'low', metrics: metrics(1, 2) }),
      run({ id: 'other-agent', targetAgentId: 'agt_2' }),
      run({ id: 'idle', status: 'idle' }),
      run({ id: 'high', metrics: metrics(3, 0) }),
    ]);

    expect(groups).toHaveLength(2);
    const main = groups.find((g) => g.agentId === 'agt_1')!;
    expect(main.runs.map((r) => r.id)).toEqual(['high', 'low', 'idle']);
  });

  it('orders groups by their most recent run', () => {
    const groups = groupRuns([
      run({ createdAt: new Date('2026-01-01'), datasetId: 'old', id: 'a' }),
      run({ createdAt: new Date('2026-09-01'), datasetId: 'new', id: 'b' }),
    ]);
    expect(groups.map((g) => g.datasetId)).toEqual(['new', 'old']);
  });

  it('splits the same agent × dataset into separate creation batches', () => {
    const groups = groupRuns([
      run({ createdAt: new Date('2026-10-01T10:00:00Z'), id: 'a1' }),
      run({ createdAt: new Date('2026-10-01T10:00:03Z'), id: 'a2' }),
      run({ createdAt: new Date('2026-10-02T10:00:00Z'), id: 'b1' }),
    ]);
    expect(groups.map((g) => g.runs.map((r) => r.id).sort())).toEqual([['b1'], ['a1', 'a2']]);
  });
});

it('leaves cross-model comparisons out of the agent run groups', () => {
  const groups = groupRuns([
    run({ id: 'agent-run' }),
    run({ config: { executionMode: 'replay' } as any, id: 'comparison', targetAgentId: null }),
  ]);
  expect(groups.flatMap((g) => g.runs.map((r) => r.id))).toEqual(['agent-run']);
});

describe('getRunPassRate', () => {
  it('has no pass rate when every finished case errored', () => {
    expect(
      getRunPassRate(
        run({ metrics: { errorCases: 3, failedCases: 0, passRate: 0, passedCases: 0 } as any }),
      ),
    ).toBeUndefined();
  });
});
