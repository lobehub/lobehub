import { describe, expect, it } from 'vitest';

import { getFlowNodeState } from './flowNodeState';

const edges = [
  { id: 'a', targetNodeKey: 'done', required: true },
  { id: 'b', targetNodeKey: 'done', required: true },
];
describe('shared graph and checklist status', () => {
  it('does not let one successful branch hide an unverified required branch', () => {
    expect(
      getFlowNodeState('done', 'ready', edges, [{ incomingEdgeId: 'a', verdict: 'passed' }]),
    ).toBe('partial');
    expect(getFlowNodeState('done', 'ready', edges, [])).toBeUndefined();
  });
  it('uses the latest retry for each branch, retaining failures on other branches', () => {
    const visits = [
      { incomingEdgeId: 'a', verdict: 'failed' as const },
      { incomingEdgeId: 'a', verdict: 'passed' as const },
    ];
    expect(
      getFlowNodeState('done', 'ready', edges, [
        ...visits,
        { incomingEdgeId: 'b', verdict: 'failed' },
      ]),
    ).toBe('failed');
    expect(
      getFlowNodeState('done', 'ready', edges, [
        ...visits,
        { incomingEdgeId: 'b', verdict: 'passed' },
      ]),
    ).toBe('passed');
  });
});

it('does not require an optional entry when its required return branch passed', () => {
  expect(
    getFlowNodeState(
      'done',
      'done',
      [{ id: 'a', targetNodeKey: 'done', required: true }],
      [{ incomingEdgeId: 'a', verdict: 'passed' }],
      false,
    ),
  ).toBe('passed');
});
