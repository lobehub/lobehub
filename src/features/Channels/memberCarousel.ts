import type { ChannelPublicMember } from '@lobechat/types';

/** Avatars on show at once in a Channel's member stack. */
export const MEMBER_CAROUSEL_SIZE = 3;

const joinedAt = (member: ChannelPublicMember) => new Date(member.joinedAt).getTime();

/** Active members, people before Agents, each in the order they joined. */
export const carouselMembers = (members: ChannelPublicMember[]) =>
  members
    .filter((member) => member.status === 'active')
    .sort(
      (a, b) =>
        Number(a.actorType === 'agent') - Number(b.actorType === 'agent') ||
        joinedAt(a) - joinedAt(b),
    );

/**
 * The avatars shown at `step`. Up to three stand still; more rotate through a window of three
 * that moves on by one per step and wraps around. Keys count steps rather than naming members, so
 * a member coming round again enters afresh on the right instead of sliding back from the left.
 */
export const carouselWindow = <T extends { id: string }>(members: T[], step: number) => {
  if (members.length <= MEMBER_CAROUSEL_SIZE)
    return members.map((member) => ({ key: member.id, member }));
  return Array.from({ length: MEMBER_CAROUSEL_SIZE }, (_, slot) => {
    const at = step + slot;
    return { key: `step-${at}`, member: members[at % members.length] };
  });
};
