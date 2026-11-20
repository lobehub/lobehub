import type { GoalEdgeKind, GoalNodeKind } from '@lobechat/types';

/** The glyph `lh goal show` prints before each node of the graph. */
export const nodeIcon: Record<GoalNodeKind, string> = {
  batch: '▦',
  dead_end: '✕',
  decision: '◆',
  experiment: '⚗',
  finding: '●',
  hazard: '⚠',
  pattern: '↻',
  problem: '◇',
  task: '▣',
  template: '▤',
  tool: '⚒',
};

/**
 * Every edge kind reads `source <kind> target`, so a row listing its INCOMING
 * edges by kind states the relationship backwards: an incoming `depends_on`
 * means the other node depends on THIS one, not the reverse. Render the inverse
 * verb instead, so each entry is a true sentence about the row it sits on.
 */
export const inverseEdgeLabel: Record<GoalEdgeKind, string> = {
  answers: 'answered by',
  confirms: 'confirmed by',
  contains: 'inside',
  contradicts: 'contradicted by',
  decomposes: 'part of',
  depends_on: 'blocks',
  derived_from: 'ancestor of',
  investigates: 'investigated by',
  leads_to: 'follows',
  produces: 'produced by',
  refutes: 'refuted by',
  supports: 'supported by',
};
