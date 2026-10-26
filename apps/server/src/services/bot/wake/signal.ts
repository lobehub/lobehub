import {
  parseDiscordMentions,
  resolveChannelKeys,
} from '@/server/services/agentSignal/scenarios/botWake/facts';
import type { WakeAuthor, WakeSignal } from '@/server/services/agentSignal/scenarios/botWake/types';

/** The part of a chat-sdk `Message` the wake pipeline reads. */
export interface WakeMessageLike {
  attachments?: unknown[];
  author?: {
    fullName?: string;
    isBot?: boolean | 'unknown';
    isMe?: boolean;
    userId?: string;
    userName?: string;
  };
  id: string;
  isMention?: boolean;
  raw?: unknown;
  text?: string;
}

export interface BuildWakeSignalInput {
  agentId: string;
  applicationId: string;
  message: WakeMessageLike;
  /** The bot owner's user id on this platform (`settings.userId`). */
  operatorUserId?: string;
  platform: string;
  platformThreadId: string;
  timestamp: number;
}

// Discord message types that are not a person typing: joins, pins, boosts, thread renames...
// 0 = default, 19 = reply, 20 = chat input command, 23 = context menu command.
const DISCORD_USER_MESSAGE_TYPES = new Set([0, 19, 20, 23]);

const readRawType = (raw: unknown): number | undefined => {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const type = (raw as { type?: unknown }).type;

  return typeof type === 'number' ? type : undefined;
};

const isSystemMessage = (platform: string, raw: unknown): boolean => {
  if (platform !== 'discord') return false;
  const type = readRawType(raw);

  return type !== undefined && !DISCORD_USER_MESSAGE_TYPES.has(type);
};

/**
 * Normalizes a chat message into the fact the wake policies judge.
 *
 * Mentions are re-derived from the text on Discord only: that is where the adapter folds
 * broadcast pings into `isMention`. Elsewhere `mentions` stays undefined and the platform's own
 * flag is trusted.
 */
export const buildWakeSignal = ({
  agentId,
  applicationId,
  message,
  operatorUserId,
  platform,
  platformThreadId,
  timestamp,
}: BuildWakeSignalInput): WakeSignal => {
  const text = message.text ?? '';
  const userId = message.author?.userId;
  const author: WakeAuthor = {
    id: userId,
    // chat-sdk reports `isBot: 'unknown'` when the platform does not say; that is not a bot.
    isBot: message.author?.isBot === true,
    isMe: message.author?.isMe === true,
    isOwner: !!operatorUserId && userId === operatorUserId,
    isSystem: isSystemMessage(platform, message.raw),
  };

  return {
    agentId,
    applicationId,
    author,
    channelKeys: resolveChannelKeys(platform, applicationId, platformThreadId),
    hasAttachments: (message.attachments?.length ?? 0) > 0,
    mentions: platform === 'discord' ? parseDiscordMentions(text, applicationId) : undefined,
    message: text,
    platform,
    platformThreadId,
    timestamp,
  };
};
