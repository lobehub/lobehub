import type { ChannelListItem, ChannelPublicMember } from '@lobechat/types';

/** The personal channel owner is implicit; only workspace channels list people. */
export const getVisibleStatusMembers = (
  members: ChannelPublicMember[],
  workspaceId: ChannelListItem['workspaceId'],
) =>
  members.filter(
    (member) => member.status === 'active' && (member.actorType === 'agent' || !!workspaceId),
  );
