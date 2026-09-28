interface AssigneeMemberLike {
  userId: string;
}

/**
 * Splits the viewer out of the assignable member list so the picker can pin
 * them right under "Unassigned" — self-assignment is the most common pick, and
 * hunting for your own row inside a directory-ordered list costs a scan every
 * time. Returns `self` undefined when the viewer is unknown or is not an
 * assignable member (personal mode, non-assignable role, private task owned by
 * someone else), which keeps the list unchanged in those cases.
 */
export const partitionSelfMember = <T extends AssigneeMemberLike>(
  members: T[],
  selfUserId?: string | null,
): { others: T[]; self?: T } => {
  if (!selfUserId) return { others: members };

  const self = members.find((member) => member.userId === selfUserId);
  if (!self) return { others: members };

  return { others: members.filter((member) => member.userId !== selfUserId), self };
};
