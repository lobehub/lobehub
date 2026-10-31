export interface GoalVisibilityLockInput {
  /** Either of the goal's agents (supervisor, dedicated executor) is private. */
  agentPrivate: boolean;
  ownerId?: string | null;
  /** The goal sits in a private workspace project. */
  projectPrivate?: boolean;
  viewerId?: string | null;
  visibility: 'private' | 'public';
}

/**
 * Why the viewer cannot switch the goal's visibility, or `undefined` when they
 * can. Mirrors the server: only the creator may, and a goal a private agent
 * runs, or one in a private project, cannot go public. Returns a `chat`
 * locale key.
 */
export const goalVisibilityLockKey = ({
  agentPrivate,
  ownerId,
  projectPrivate,
  viewerId,
  visibility,
}: GoalVisibilityLockInput) => {
  if (!ownerId || ownerId !== viewerId) return 'goalDetail.visibility.creatorOnly' as const;
  if (visibility === 'private' && agentPrivate)
    return 'goalDetail.visibility.privateAgentLocked' as const;
  if (visibility === 'private' && projectPrivate)
    return 'goalDetail.visibility.privateProjectLocked' as const;
  return undefined;
};
