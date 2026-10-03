import { isGoalPrompt } from '@lobechat/builtin-tool-goal';
import type { UIChatMessage } from '@lobechat/types';

import type { GoalListItem } from '@/services/goal';

import { deriveOperationGoals } from '../../Messages/GoalTaskCard/deriveOperationGoals';

/** The tray is a pointer, not a list — past this the goal page's list is the right surface. */
export const MAX_LINKED_GOALS = 3;

/**
 * Goals linked to the topic that still need a surface in this conversation.
 *
 * A goal created by the builtin `createGoal` tool already renders as a live card
 * inside its assistant turn, so the tray skips it. A goal a CLI agent created
 * with `lh goal create --conversation` keeps its tray row even though its turn
 * now carries a card too: that agent supervises it from this conversation, so
 * its status stays in reach above the composer after the turn scrolls away.
 */
export const selectLinkedGoals = (
  goals: GoalListItem[] = [],
  messages: UIChatMessage[] = [],
): GoalListItem[] => {
  const carded = new Set(
    messages.flatMap((message) =>
      deriveOperationGoals(message.children ?? []).flatMap(({ goalId, source }) =>
        source === 'tool' ? [goalId] : [],
      ),
    ),
  );

  return goals.filter(({ goal }) => !carded.has(goal.id)).slice(0, MAX_LINKED_GOALS);
};

/**
 * Whether the run in flight can be the one creating a goal: something is
 * generating and the latest user message is a `/goal` request. Polling for new
 * goals on every generation would hit the goal list every few seconds for
 * conversations that never asked for one.
 */
export const isGoalRequestGenerating = (
  messages: UIChatMessage[] = [],
  generating: boolean,
): boolean =>
  generating && isGoalPrompt(messages.findLast((message) => message.role === 'user')?.content);
