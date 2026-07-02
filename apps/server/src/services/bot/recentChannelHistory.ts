import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';

/** Max characters kept per pre-injected user message, to bound the prompt size. */
const MESSAGE_MAX_CHARS = 300;

export interface RecentChannelHistory {
  /** Recent topic titles from the same channel, most-recent first. */
  topics: string[];
  /** The last few user messages across those topics, oldest-first. */
  userMessages: string[];
}

export interface BuildRecentChannelHistoryParams {
  /** Skip the current topic so we only surface prior sessions. */
  excludeTopicId?: string;
  /** Last N user messages across the recent topics. */
  messageLimit?: number;
  /** IM channel identity from `ChatTopicBotContext.platformThreadId`. */
  platformThreadId?: string;
  /** How many recent same-channel topics to pull. */
  topicLimit?: number;
}

const truncate = (text: string) =>
  text.length > MESSAGE_MAX_CHARS ? `${text.slice(0, MESSAGE_MAX_CHARS)}…` : text;

// IM user messages are stored with a leading `<speaker ... />` tag (see how bot
// prompts are formatted); strip it so the injected history reads as plain text.
const stripSpeakerTag = (text: string) => text.replace(/^\s*<speaker\b[^>]*\/>\s*/i, '');

/**
 * Assemble a compact cross-session summary of the same IM channel — recent topic
 * titles plus the last few user messages — for platforms that can't read chat
 * history at runtime (e.g. WeChat, whose `readMessages` throws). The current
 * topic is excluded so this is purely prior context; returns `undefined` when
 * there's nothing to inject.
 *
 * Channel-scoped, not agent-scoped: matches topics by `metadata.bot.platformThreadId`
 * so a shared agent serving web + multiple channels doesn't bleed context across
 * surfaces.
 */
export const buildRecentChannelHistory = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId: string | undefined,
  {
    excludeTopicId,
    messageLimit = 4,
    platformThreadId,
    topicLimit = 5,
  }: BuildRecentChannelHistoryParams,
): Promise<RecentChannelHistory | undefined> => {
  if (!platformThreadId) return undefined;

  const topicModel = new TopicModel(db, userId, workspaceId);
  const recentTopics = await topicModel.findRecentByBotThread(platformThreadId, {
    excludeTopicId,
    limit: topicLimit,
  });
  if (recentTopics.length === 0) return undefined;

  const messageModel = new MessageModel(db, userId, workspaceId);
  const recentMessages = await messageModel.queryRecentUserMessagesByTopics(
    recentTopics.map((t) => t.id),
    messageLimit,
  );

  const topics = recentTopics
    .map((t) => t.title?.trim())
    .filter((title): title is string => !!title);
  const userMessages = recentMessages
    .map((m) => truncate(stripSpeakerTag(m.content).trim()))
    .filter(Boolean);

  if (topics.length === 0 && userMessages.length === 0) return undefined;

  return { topics, userMessages };
};
