interface ScopeTogglePlacementInput {
  hasNeedsYou: boolean;
  hasRunning: boolean;
  hasUnread: boolean;
  preferUnread?: boolean;
}

/** Place the team scope control on the first section whose contents it governs. */
export const resolveScopeToggleSection = ({
  hasNeedsYou,
  hasRunning,
  hasUnread,
  preferUnread,
}: ScopeTogglePlacementInput): 'needsYou' | 'running' | 'unread' | null => {
  if (preferUnread && hasUnread) return 'unread';
  if (hasNeedsYou) return 'needsYou';
  if (hasUnread) return 'unread';
  if (hasRunning) return 'running';
  return null;
};

interface InboxScopeTogglePlacementInput {
  hiddenWidgets: string[];
  hideNeedsYou?: boolean;
  hideUnread?: boolean;
  needsYouCount: number;
  preferUnread?: boolean;
  runningCount: number;
  unreadCount: number;
}

export const resolveInboxScopeToggleSection = ({
  hiddenWidgets,
  hideNeedsYou,
  hideUnread,
  needsYouCount,
  preferUnread,
  runningCount,
  unreadCount,
}: InboxScopeTogglePlacementInput): 'needsYou' | 'running' | 'unread' | null =>
  resolveScopeToggleSection({
    hasNeedsYou: !hideNeedsYou && needsYouCount > 0 && !hiddenWidgets.includes('needsYou'),
    hasRunning: runningCount > 0 && !hiddenWidgets.includes('running'),
    hasUnread: !hideUnread && unreadCount > 0 && !hiddenWidgets.includes('unread'),
    preferUnread,
  });

export const filterTopicsForInboxScope = <T extends { userId?: string }>(
  topics: readonly T[],
  myId: string | undefined,
  teamView: boolean,
): T[] => (teamView ? [...topics] : topics.filter((topic) => topic.userId === myId));
