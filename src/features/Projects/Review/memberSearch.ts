export interface MemberCandidate {
  avatar?: string | null;
  email?: string | null;
  name: string;
  userId: string;
}

/** Matches a workspace member by display name or email, ignoring case. */
export const filterMemberCandidates = <T extends MemberCandidate>(
  candidates: T[],
  query: string,
): T[] => {
  const keyword = query.trim().toLocaleLowerCase();
  if (!keyword) return candidates;
  return candidates.filter((member) =>
    [member.name, member.email].some((field) => field?.toLocaleLowerCase().includes(keyword)),
  );
};

/**
 * Every role change is authorized as the acting admin, and a project role overrides the
 * workspace one. Saving the actor's own change first could demote them mid-batch and get the
 * rest refused, so it goes last.
 */
export const actorLast = (userIds: string[], actorId?: string): string[] =>
  actorId && userIds.includes(actorId)
    ? [...userIds.filter((id) => id !== actorId), actorId]
    : userIds;
