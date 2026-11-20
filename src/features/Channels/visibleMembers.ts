import type { ChannelListItem, ChannelPublicMember } from '@lobechat/types';

/** The personal channel owner is implicit; only workspace channels list people. */
export const getVisibleStatusMembers = (
  members: ChannelPublicMember[],
  workspaceId: ChannelListItem['workspaceId'],
) =>
  members.filter(
    (member) => member.status === 'active' && (member.actorType === 'agent' || !!workspaceId),
  );

/** People first, then Agents, each group keeping its join order. */
export const groupMembersByActor = <T extends { member: Pick<ChannelPublicMember, 'actorType'> }>(
  entries: T[],
) => ({
  agents: entries.filter((entry) => entry.member.actorType === 'agent'),
  people: entries.filter((entry) => entry.member.actorType !== 'agent'),
});
