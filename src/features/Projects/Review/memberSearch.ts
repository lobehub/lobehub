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
