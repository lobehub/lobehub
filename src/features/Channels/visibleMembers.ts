import type { ChannelListItem, ChannelPublicMember } from '@lobechat/types';

export const isActiveChannelMember = (member: ChannelPublicMember) =>
  member.status === 'active' &&
  (member.actorType !== 'agent' || (!!member.agentId && !member.agentDeleted));

/** Historical membership stays readable without counting as a potential responder. */
export const getFormerAgentMembers = (members: ChannelPublicMember[]) => {
  const activeIds = new Set(members.filter(isActiveChannelMember).map((member) => member.agentId));
  const former = members.filter(
    (member) =>
      member.actorType === 'agent' &&
      !isActiveChannelMember(member) &&
      (!member.agentId || !activeIds.has(member.agentId)),
  );
  // Re-inviting creates a new membership so old jobs keep their identity. The
  // history roster shows that Agent once, using its latest membership label.
  return [...new Map(former.map((member) => [member.agentId ?? member.id, member])).values()];
};

/** The personal channel owner is implicit; only workspace channels list people. */
export const getVisibleStatusMembers = (
  members: ChannelPublicMember[],
  workspaceId: ChannelListItem['workspaceId'],
) =>
  members.filter(
    (member) => isActiveChannelMember(member) && (member.actorType === 'agent' || !!workspaceId),
  );
