import type { GoalGraphSnapshot, GoalNodeKind } from '@lobechat/types';

/** Enough of the graph to say what the goal is about without flooding the title prompt. */
const MAX_TITLE_CONTEXT_ITEMS = 20;

/**
 * The goal as a conversation for `chainSummaryTitle`, so goals are named by the
 * same chain and model as topics. The ask is the requirement, not the title: a
 * goal whose title is the whole pasted prompt is exactly the one being renamed.
 * Its Tasks and findings read as the reply, which is what the goal turned into.
 */
export const buildGoalTitleMessages = ({
  goal,
  nodes = [],
}: GoalGraphSnapshot): Array<{ content: string; role: 'assistant' | 'user' }> => {
  const ofKind = (kind: GoalNodeKind) => nodes.filter((node) => node.kind === kind);

  const ask = goal.requirement?.trim() || goal.title;
  // One cap across both kinds, Tasks first.
  const progress = [...ofKind('task'), ...ofKind('finding')]
    .slice(0, MAX_TITLE_CONTEXT_ITEMS)
    .map((node) => `- ${node.kind === 'task' ? 'Task' : 'Finding'}: ${node.title}`);

  return [
    { content: ask, role: 'user' },
    ...(progress.length > 0 ? [{ content: progress.join('\n'), role: 'assistant' as const }] : []),
  ];
};
