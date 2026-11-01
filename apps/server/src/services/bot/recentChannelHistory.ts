import type { RecentChannelHistory, RecentChannelTopic } from '@lobechat/prompts';

import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';

/** Max characters kept per pre-injected text field, to bound the prompt size. */
const TEXT_MAX_CHARS = 300;

export interface BuildRecentChannelHistoryParams {
  /** IM channel identity from `ChatTopicBotContext.platformThreadId`. */
  platformThreadId?: string;
  /** How many recent same-channel topics to pull. */
  topicLimit?: number;
}

const truncate = (text: string) =>
  text.length > TEXT_MAX_CHARS ? `${text.slice(0, TEXT_MAX_CHARS)}…` : text;

// IM user messages are stored with a leading `<speaker ... />` tag (see how bot
// prompts are formatted); strip it so the injected history reads as plain text.
const stripSpeakerTag = (text: string) => text.replace(/^\s*<speaker\b[^>]*\/>\s*/i, '');

/**
 * Assemble a compact cross-session summary of the same IM channel — one entry
 * per recent topic (id, name, createdAt, description, last user message) — for
 * platforms that can't read chat history at runtime (e.g. WeChat, whose
 * `readMessages` throws). Topic ids are included so the model can pull a full
 * transcript on demand via `lh topic view <id>`; returns `undefined` when
 * there's nothing to inject.
 *
 * Only called when a run OPENS a new topic (the caller gates on that), so the
 * current session isn't in the DB yet and can't show up in its own history.
 *
 * Channel-scoped, not agent-scoped: matches topics by `metadata.bot.platformThreadId`
 * so a shared agent serving web + multiple channels doesn't bleed context across
 * surfaces.
 */
export const buildRecentChannelHistory = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId: string | undefined,
  { platformThreadId, topicLimit = 3 }: BuildRecentChannelHistoryParams,
): Promise<RecentChannelHistory | undefined> => {
  if (!platformThreadId) return undefined;

  const topicModel = new TopicModel(db, userId, workspaceId);
  const recentTopics = await topicModel.findRecentByBotThread(platformThreadId, {
    limit: topicLimit,
  });
  if (recentTopics.length === 0) return undefined;

  const messageModel = new MessageModel(db, userId, workspaceId);
  const lastUserMessages = await messageModel.queryLastUserMessageByTopics(
    recentTopics.map((t) => t.id),
  );

  const topics: RecentChannelTopic[] = recentTopics.map((t) => {
    const lastUserMessage = lastUserMessages.get(t.id);
    return {
      createdAt: t.createdAt?.toISOString(),
      description: t.description?.trim() ? truncate(t.description.trim()) : undefined,
      id: t.id,
      lastUserMessage: lastUserMessage
        ? truncate(stripSpeakerTag(lastUserMessage).trim())
        : undefined,
      name: t.title?.trim() ?? '',
    };
  });

  return { topics };
};
