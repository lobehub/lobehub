import { Position } from '@xyflow/react';

/** The caption is the only place the branch condition is readable, so it claims the gutter. */
const MAX_LABEL_WIDTH = 200;
/** Clear space kept between the caption and the card on each side of the gutter. */
const SIDE_CLEARANCE = 48;

/** Keep ordinary forward-branch captions in the gutter beside their destination. */
export function getFlowEdgeLabelLayout({
  sourceX,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  lane,
  labelX,
  labelY,
}: {
  sourceX: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
  lane: number;
  labelX: number;
  labelY: number;
}) {
  const gap = targetX - sourceX;
  if (sourcePosition === Position.Right && targetPosition === Position.Left && gap > 16 && !lane)
    return {
      x: (sourceX + targetX) / 2,
      y: targetY,
      maxWidth: Math.min(MAX_LABEL_WIDTH, gap - SIDE_CLEARANCE),
    };
  return { x: labelX, y: labelY, maxWidth: MAX_LABEL_WIDTH };
}
