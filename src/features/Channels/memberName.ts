import { DEFAULT_AVATAR, DEFAULT_USER_AVATAR } from '@lobechat/const';
import type { ChannelPublicMember, ChannelPublicMessage } from '@lobechat/types';

export const memberName = (member: ChannelPublicMember | undefined, fallback: string) =>
  member?.name || member?.userName || member?.username || fallback;

export const memberAvatar = (member: ChannelPublicMember | undefined) =>
  member?.actorType === 'user'
    ? member.userAvatar || DEFAULT_USER_AVATAR
    : member?.avatar || DEFAULT_AVATAR;

/** Only the viewer's own human messages may use their live personal avatar. */
export const isCurrentUserAuthor = (
  author: ChannelPublicMessage['author'],
  currentUserId: string | undefined,
) => !!currentUserId && author.type === 'user' && author.id === currentUserId;

/** Mention/menu identities use the same viewer-owned avatar as the timeline. */
export const isCurrentUserMember = (
  member: Pick<ChannelPublicMember, 'actorType' | 'userId'>,
  currentUserId: string | undefined,
) => !!currentUserId && member.actorType === 'user' && member.userId === currentUserId;

export const authorAvatar = (author: ChannelPublicMessage['author']) =>
  author.avatar || (author.type === 'user' ? DEFAULT_USER_AVATAR : DEFAULT_AVATAR);
