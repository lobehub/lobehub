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

export const filterTopicsForInboxScope = <T extends { userId?: string }>(
  topics: readonly T[],
  myId: string | undefined,
  teamView: boolean,
): T[] => (teamView ? [...topics] : topics.filter((topic) => topic.userId === myId));
