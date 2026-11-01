interface ScopeTogglePlacementInput {
  hasNeedsYou: boolean;
  hasUnread: boolean;
  preferUnread?: boolean;
}

/** Place the team scope control on the first section whose contents it governs. */
export const resolveScopeToggleSection = ({
  hasNeedsYou,
  hasUnread,
  preferUnread,
}: ScopeTogglePlacementInput): 'needsYou' | 'unread' | null => {
  if (preferUnread && hasUnread) return 'unread';
  if (hasNeedsYou) return 'needsYou';
  if (hasUnread) return 'unread';
  return null;
};

interface InboxScopeTogglePlacementInput {
  hiddenWidgets: string[];
  hideNeedsYou?: boolean;
  hideUnread?: boolean;
  needsYouCount: number;
  preferUnread?: boolean;
  unreadCount: number;
}

export const resolveInboxScopeToggleSection = ({
  hiddenWidgets,
  hideNeedsYou,
  hideUnread,
  needsYouCount,
  preferUnread,
  unreadCount,
}: InboxScopeTogglePlacementInput): 'needsYou' | 'unread' | null =>
  resolveScopeToggleSection({
    hasNeedsYou: !hideNeedsYou && needsYouCount > 0 && !hiddenWidgets.includes('needsYou'),
    hasUnread: !hideUnread && unreadCount > 0 && !hiddenWidgets.includes('unread'),
    preferUnread,
  });

/**
 * Narrow the workspace-wide inbox feed to one scope.
 *
 * - `team`: what the workspace is working on. A topic owned by a PRIVATE
 *   agent/group is a personal conversation and never belongs here — not even
 *   the viewer's own, which is how a private agent's topic used to show up
 *   under the team tab.
 * - `mine`: the viewer's own rows, private conversations included.
 */
export const filterTopicsForInboxScope = <
  T extends { parentVisibility?: string | null; userId?: string },
>(
  topics: readonly T[],
  myId: string | undefined,
  teamView: boolean,
): T[] =>
  teamView
    ? topics.filter((topic) => topic.parentVisibility !== 'private')
    : topics.filter((topic) => topic.userId === myId);
