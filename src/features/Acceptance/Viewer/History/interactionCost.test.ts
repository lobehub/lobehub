import { describe, expect, it } from 'vitest';

import { buildCheckLabels, selectPricedRound } from './interactionCost';

const cost = {
  activeSeconds: 4,
  model: 'goms-klm@lobe-v1',
  operators: { K: 1, M: 2, P: 1, R_ms: 7894 },
  phases: [
    {
      activeSeconds: 2.7,
      checkItemId: 'cost-priced',
      id: 'open-acceptance',
      seconds: 10.59,
      waitSeconds: 7.89,
    },
  ],
  totalSeconds: 11.89,
  waitSeconds: 7.89,
};

const round = (roundIndex: number, metadata: unknown) => ({ run: { metadata, roundIndex } });

describe('selectPricedRound', () => {
  it('reads the cost a round recorded', () => {
    const priced = selectPricedRound([round(1, { interactionCost: cost })]);

    expect(priced?.roundIndex).toBe(1);
    expect(priced?.cost.totalSeconds).toBe(11.89);
    expect(priced?.cost.phases?.[0].checkItemId).toBe('cost-priced');
  });

  it('keeps the last priced round when a later round has no trace', () => {
    // A follow-up CLI round measures nothing. Falling through to it would read
    // as "the flow became free" instead of "this round measured nothing".
    const priced = selectPricedRound([
      round(1, { interactionCost: cost }),
      round(2, { origin: { topicId: 't' } }),
    ]);

    expect(priced?.roundIndex).toBe(1);
  });

  it('prefers the newest measurement when several rounds are priced', () => {
    const priced = selectPricedRound([
      round(1, { interactionCost: cost }),
      round(2, { interactionCost: { ...cost, totalSeconds: 3.5 } }),
    ]);

    expect(priced).toMatchObject({ roundIndex: 2 });
    expect(priced?.cost.totalSeconds).toBe(3.5);
  });

  it('returns null when no round was priced', () => {
    // A CLI-only acceptance must render no measurement block at all.
    expect(selectPricedRound([round(1, { origin: {} })])).toBeNull();
    expect(selectPricedRound([])).toBeNull();
  });

  it('ignores a metadata bag whose cost has no total', () => {
    expect(selectPricedRound([round(1, { interactionCost: { model: 'x' } })])).toBeNull();
  });
});

describe('buildCheckLabels', () => {
  it('maps a check id onto the title a reviewer reads', () => {
    expect(buildCheckLabels([{ id: 'cost-priced', title: '平台从 trace 计算交互成本' }])).toEqual({
      'cost-priced': '平台从 trace 计算交互成本',
    });
  });
});
