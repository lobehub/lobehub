interface ScopeTogglePlacementInput {
  hasNeedsYou: boolean;
  hasRunning: boolean;
  hasUnread: boolean;
}

/** Place the team scope control on the first section whose contents it governs. */
export const resolveScopeToggleSection = ({
  hasNeedsYou,
  hasRunning,
  hasUnread,
}: ScopeTogglePlacementInput): 'needsYou' | 'running' | 'unread' | null => {
  if (hasNeedsYou) return 'needsYou';
  if (hasUnread) return 'unread';
  if (hasRunning) return 'running';
  return null;
};
