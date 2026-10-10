import {
  agentDisplayName,
  type AgentSenderMetadata,
  type BotSenderMetadata,
  type MessageSender,
  RequestTrigger,
} from '@lobechat/types';

import { parseSpeakerTag } from '@/store/chat/utils/parseSpeakerTag';

/** The shape of a user row this resolver needs — the server-written blocks live on it. */
export interface SenderIdentitySource {
  content?: null | string;
  metadata?: null | {
    agentSender?: AgentSenderMetadata | null;
    botSender?: BotSenderMetadata | null;
    trigger?: RequestTrigger;
  };
}

/**
 * Agent sender for a user message: the structured block the server wrote for an
 * agent → agent turn. Every render path that can show such a row must read it
 * through here — a path that resolves the sender without it falls back to the
 * human owner the row was persisted under, i.e. it misattributes the message.
 */
export const getAgentSender = (message: {
  metadata?: { agentSender?: AgentSenderMetadata | null } | null;
}): AgentSenderMetadata | undefined => message.metadata?.agentSender ?? undefined;

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

interface ResolveSenderIdentityOptions {
  /** Viewer's user id, used to detect their own messages. */
  currentUserId?: null | string;
  /**
   * The user row being rendered. The server-written sender blocks are read off
   * it here rather than passed in, so a renderer cannot resolve an identity
   * while silently dropping one of them — the compressed group re-renders user
   * rows through a second path that has to agree with this one.
   */
  message: SenderIdentitySource;
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
  message,
  selfAvatar,
  selfTitle,
  sender,
  unknownLabel,
}: ResolveSenderIdentityOptions) => {
  const agentSender = getAgentSender(message);
  const botSender = getBotSender(message);

  // Another agent sent this turn. It is never the viewer's own message, and the
  // label follows the product-wide agent naming rule (personal name over role).
  if (agentSender) {
    return {
      avatar: agentSender.avatar || undefined,
      isOwn: false,
      title: agentDisplayName(agentSender) || unknownLabel,
    };
  }

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
