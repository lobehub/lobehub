import { Position } from '@xyflow/react';
import { describe, expect, it } from 'vitest';

import { getFlowEdgeLabelLayout } from './flowEdgeLabel';

const branch = {
  sourceX: 260,
  targetX: 372,
  targetY: 240,
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
  lane: 0,
  labelX: 316,
  labelY: 120,
};

describe('forward branch labels', () => {
  it('keeps a diagonal branch caption inside the gutter and aligned with its destination', () => {
    const label = getFlowEdgeLabelLayout(branch);
    expect(label.y).toBe(branch.targetY);
    expect(label.x - label.maxWidth / 2).toBeGreaterThan(branch.sourceX);
    expect(label.x + label.maxWidth / 2).toBeLessThan(branch.targetX);
  });

  it('spends the gutter on the caption but keeps it clear of the cards beside it', () => {
    expect(getFlowEdgeLabelLayout({ ...branch, targetX: 508 }).maxWidth).toBe(200);
    const tight = getFlowEdgeLabelLayout({ ...branch, targetX: 468 });
    expect(tight.maxWidth).toBe(160);
    expect(tight.x - tight.maxWidth / 2 - branch.sourceX).toBe(24);
  });

  it('separates captions for branches with different destinations', () => {
    const first = getFlowEdgeLabelLayout(branch);
    const second = getFlowEdgeLabelLayout({ ...branch, targetY: 420 });
    expect(second.y - first.y).toBe(180);
  });

  it.each([
    { lane: 64 },
    { sourcePosition: Position.Bottom, targetPosition: Position.Top },
    { targetX: 100 },
  ])('preserves the routed caption position for non-forward edges: %j', (overrides) => {
    expect(getFlowEdgeLabelLayout({ ...branch, ...overrides })).toEqual({
      x: branch.labelX,
      y: branch.labelY,
      maxWidth: 200,
    });
  });
});
