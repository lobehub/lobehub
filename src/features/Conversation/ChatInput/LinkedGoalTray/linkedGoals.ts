import type { UIChatMessage } from '@lobechat/types';

import type { GoalListItem } from '@/services/goal';

import { deriveOperationGoals } from '../../Messages/GoalTaskCard/deriveOperationGoals';

/** The tray is a pointer, not a list — past this the goal page's list is the right surface. */
export const MAX_LINKED_GOALS = 3;

/**
 * Goals linked to the topic that still need a surface in this conversation.
 *
 * A goal created by the builtin `createGoal` tool already renders as a live card
 * inside its assistant turn, so the tray skips it; what remains are goals the
 * conversation planned some other way — a CLI agent's `lh goal create
 * --conversation` leaves only Bash output behind.
 */
export const selectLinkedGoals = (
  goals: GoalListItem[] = [],
  messages: UIChatMessage[] = [],
): GoalListItem[] => {
  const carded = new Set(
    messages.flatMap((message) =>
      deriveOperationGoals(message.children ?? []).map(({ goalId }) => goalId),
    ),
  );

  return goals.filter(({ goal }) => !carded.has(goal.id)).slice(0, MAX_LINKED_GOALS);
};
