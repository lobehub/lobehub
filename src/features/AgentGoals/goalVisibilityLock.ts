export interface GoalVisibilityLockInput {
  /** Either of the goal's agents (supervisor, dedicated executor) is private. */
  agentPrivate: boolean;
  ownerId?: string | null;
  viewerId?: string | null;
  visibility: 'private' | 'public';
}

/**
 * Why the viewer cannot switch the goal's visibility, or `undefined` when they
 * can. Mirrors the server: only the creator may, and a goal a private agent
 * runs cannot go public. Returns a `chat` locale key.
 */
export const goalVisibilityLockKey = ({
  agentPrivate,
  ownerId,
  viewerId,
  visibility,
}: GoalVisibilityLockInput) => {
  if (!ownerId || ownerId !== viewerId) return 'goalDetail.visibility.creatorOnly' as const;
  if (visibility === 'private' && agentPrivate)
    return 'goalDetail.visibility.privateAgentLocked' as const;
  return undefined;
};
