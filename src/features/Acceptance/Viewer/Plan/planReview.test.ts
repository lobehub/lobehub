import { describe, expect, it } from 'vitest';

import { flowPlanPhase } from './planReview';

const snapshot = {
  flowId: 'flow',
  title: 'Send message',
  entryNodeId: 'entry',
  nodes: [],
  edges: [],
};

describe('flow plan review phase', () => {
  it('distinguishes drafts from execution and leaves checklist-only plans alone', () => {
    expect(flowPlanPhase(undefined)).toBeUndefined();
    expect(flowPlanPhase({ run: { status: 'planned', flowSnapshots: null } })).toBeUndefined();
    expect(
      flowPlanPhase({
        run: { status: 'planned', flowSnapshots: [snapshot] },
      }),
    ).toBe('draft');
    expect(
      flowPlanPhase({
        run: {
          status: 'collecting_evidence',
          flowSnapshots: [snapshot],
        },
      }),
    ).toBeUndefined();
  });
});
