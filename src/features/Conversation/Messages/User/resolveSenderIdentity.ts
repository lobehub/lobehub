import { type MessageSender } from '@lobechat/types';

interface ResolveSenderIdentityOptions {
  /** Viewer's user id, used to detect their own messages. */
  currentUserId?: string | null;
  /** Viewer's avatar, applied only to their own messages. */
  selfAvatar: string;
  /** Viewer's display name, applied only to their own messages. */
  selfTitle?: string;
  sender?: MessageSender | null;
  /** Label for another member whose profile carries no usable name. */
  unknownLabel: string;
}

/**
 * Resolve the avatar/title shown on a user message bubble.
 *
 * Only local optimistic/streaming rows lack a `sender` (every server read path
 * hydrates it), and those are authored by the viewer — so self identity applies
 * only when the row is theirs. A resolved sender that is someone else must
 * NEVER fall back to the viewer's avatar/name, or shared workspace topics
 * misattribute their messages to whoever is looking.
 */
export const resolveSenderIdentity = ({
  currentUserId,
  selfAvatar,
  selfTitle,
  sender,
  unknownLabel,
}: ResolveSenderIdentityOptions) => {
  const isOwn = !sender || sender.id === currentUserId;
  const senderName = sender?.fullName || sender?.username || '';
  const title = isOwn ? senderName || selfTitle || '' : senderName || unknownLabel;
  // Left undefined on purpose for an avatar-less other member: `@/components/Avatar`
  // derives initials from the resolved `title`, which is a far better
  // placeholder than borrowing the viewer's picture.
  const avatar = sender?.avatar || (isOwn ? selfAvatar : undefined);

  return { avatar, isOwn, title };
};
