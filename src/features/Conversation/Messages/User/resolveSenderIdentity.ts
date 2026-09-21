import { type BotSenderMetadata, type MessageSender, RequestTrigger } from '@lobechat/types';

import { parseSpeakerTag } from '@/store/chat/utils/parseSpeakerTag';

interface ResolveSenderIdentityOptions {
  /**
   * Real platform author of a bot-channel message. Wins over `sender`, which
   * for such rows is the bot OWNER's account rather than who actually typed.
   */
  botSender?: BotSenderMetadata | null;
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
  botSender,
  currentUserId,
  selfAvatar,
  selfTitle,
  sender,
  unknownLabel,
}: ResolveSenderIdentityOptions) => {
  if (botSender) {
    return {
      avatar: botSender.avatar || undefined,
      isOwn: false,
      title: botSender.fullName || botSender.username || unknownLabel,
    };
  }

  const isOwn = !sender || sender.id === currentUserId;
  const senderName = sender?.fullName || sender?.username || '';
  const title = isOwn ? senderName || selfTitle || '' : senderName || unknownLabel;
  // Left undefined on purpose for an avatar-less other member: `@/components/Avatar`
  // derives initials from the resolved `title`, which is a far better
  // placeholder than borrowing the viewer's picture.
  const avatar = sender?.avatar || (isOwn ? selfAvatar : undefined);

  return { avatar, isOwn, title };
};

/**
 * Bot-channel sender for a user message: the structured block written by the
 * server, falling back to the `<speaker>` tag older rows still carry inline.
 */
export const getBotSender = (message: {
  content?: string | null;
  metadata?: { botSender?: BotSenderMetadata | null; trigger?: RequestTrigger } | null;
}): BotSenderMetadata | undefined =>
  message.metadata?.botSender ??
  (message.metadata?.trigger === RequestTrigger.Bot ? parseSpeakerTag(message.content) : undefined);
