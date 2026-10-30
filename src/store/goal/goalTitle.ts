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
  const titlesOf = (kind: GoalNodeKind, label: string) =>
    nodes
      .filter((node) => node.kind === kind)
      .slice(0, MAX_TITLE_CONTEXT_ITEMS)
      .map((node) => `- ${label}: ${node.title}`);

  const ask = goal.requirement?.trim() || goal.title;
  const progress = [...titlesOf('task', 'Task'), ...titlesOf('finding', 'Finding')];

  return [
    { content: ask, role: 'user' },
    ...(progress.length > 0 ? [{ content: progress.join('\n'), role: 'assistant' as const }] : []),
  ];
};
