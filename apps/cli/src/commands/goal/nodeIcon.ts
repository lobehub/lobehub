import type { GoalNodeKind } from '@lobechat/types';

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
