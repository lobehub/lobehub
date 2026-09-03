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

export const filterTopicsForInboxScope = <T extends { userId?: string }>(
  topics: readonly T[],
  myId: string | undefined,
  teamView: boolean,
): T[] => (teamView ? [...topics] : topics.filter((topic) => topic.userId === myId));
