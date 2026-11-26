import { partitionSelfMember } from '../../features/assigneeMemberOptions';

interface MemberLike {
  userId: string;
}

/**
 * Orders the member values of the Assignee / Creator filters the way the
 * Assign picker does, through the same `partitionSelfMember`: the viewer first
 * and ungrouped, everyone else under the workspace member section.
 */
export const buildMemberFilterOptions = <M extends MemberLike, O extends object>(
  members: M[],
  selfUserId: string | null | undefined,
  memberGroup: string,
  toOption: (member: M) => O,
): (O & { group?: string })[] => {
  const { others, self } = partitionSelfMember(members, selfUserId);
  return [
    ...(self ? [toOption(self)] : []),
    ...others.map((member) => ({ ...toOption(member), group: memberGroup })),
  ];
};
