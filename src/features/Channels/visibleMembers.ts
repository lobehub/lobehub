import type { ChannelPublicMember } from '@lobechat/types';

/**
 * Everyone still in the Channel. A personal group holds the owner's contacts too, so it lists
 * people the same way a workspace Channel does.
 */
export const getVisibleStatusMembers = (members: ChannelPublicMember[]) =>
  members.filter((member) => member.status === 'active');

/** People first, then Agents, each group keeping its join order. */
export const groupMembersByActor = <T extends { member: Pick<ChannelPublicMember, 'actorType'> }>(
  entries: T[],
) => ({
  agents: entries.filter((entry) => entry.member.actorType === 'agent'),
  people: entries.filter((entry) => entry.member.actorType !== 'agent'),
});
