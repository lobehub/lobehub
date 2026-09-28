import { describe, expect, it } from 'vitest';

import type { AcceptanceBundle } from '@/services/verify';

import { checksForTurn } from './turnChecks';

const bundle = {
  rounds: [{ run: { roundIndex: 1, plan: [{ id: 'check', name: 'Original check' }] } }],
  checks: [
    {
      id: 'check',
      title: 'Latest',
      resultRound: 2,
      reviews: [],
      state: 'passed',
      evidence: [{ id: 'new-image' }],
      result: { id: 'new-result' },
      timeline: [
        {
          roundIndex: 1,
          state: 'failed',
          title: 'Original check',
          evidence: [{ id: 'old-image' }],
        },
      ],
    },
  ],
} as unknown as AcceptanceBundle;

describe('round evidence selection', () => {
  it('shows the selected round evidence and never pairs it with the latest outcome', () => {
    const [check] = checksForTurn(bundle, 1);
    expect(check.title).toBe('Original check');
    expect(check.state).toBe('failed');
    expect(check.evidence).toEqual([{ id: 'old-image' }]);
    expect(check.result).toBeUndefined();
    expect(bundle.checks[0].title).toBe('Latest');
  });
  it('keeps the aggregate and does not invent results for absent rounds', () => {
    expect(checksForTurn(bundle, null)).toBe(bundle.checks);
    expect(checksForTurn(bundle, 3)).toEqual([]);
  });
});

it('shows a planned replay before it has results even when its old id was superseded', () => {
  const data = {
    ...bundle,
    rounds: [
      {
        run: {
          roundIndex: 3,
          plan: [
            {
              id: 'old-check',
              title: 'Frozen check',
              required: true,
              sourceFlowNode: { flowId: 'flow', nodeId: 'node' },
            },
          ],
        },
      },
    ],
    checks: [
      {
        ...bundle.checks[0],
        id: 'replacement',
        supersededIds: ['old-check'],
        userReview: { action: 'accept' },
      },
    ],
  } as unknown as AcceptanceBundle;
  const [check] = checksForTurn(data, 3);
  expect(check).toMatchObject({
    id: 'old-check',
    title: 'Frozen check',
    state: 'not_executed',
    evidence: [],
    reviews: [],
  });
  expect(check.result).toBeUndefined();
  expect(check.userReview).toBeUndefined();
});
