import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { MessageModel } from '@/database/models/message';
import type { LobeChatDatabase } from '@/database/type';
import { TopicReferenceService } from '@/server/services/topicReference';

export const topicTranscriptInput = z.object({
  includeMessages: z.boolean().default(true),
  limit: z.number().int().min(1).max(500).default(50),
  offset: z.number().int().min(0).default(0),
  topicId: z.string(),
});

export type TopicTranscriptInput = z.infer<typeof topicTranscriptInput>;

/**
 * One topic and a page of its transcript, as `lh topic view` shows it.
 *
 * Shared by `getTopicTranscript` (a user session) and
 * `getTopicTranscriptOperation` (a run's operation token), so what a topic read
 * may return is decided in one place for both callers.
 */
export const readTopicTranscript = async (
  scope: { db: LobeChatDatabase; userId: string; workspaceId?: string },
  input: TopicTranscriptInput,
) => {
  // `lh topic view` from a workspace run may be given one of the user's personal topic ids.
  const topic = await new TopicReferenceService(
    scope.db,
    scope.userId,
    scope.workspaceId,
  ).findTopic(input.topicId);

  if (!topic) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: `Topic not found: ${input.topicId}`,
    });
  }

  if (!input.includeMessages) {
    return { items: [], topic, total: null };
  }

  const transcript = await new MessageModel(
    scope.db,
    scope.userId,
    topic.workspaceId ?? undefined,
  ).queryTopicTranscript({
    limit: input.limit,
    offset: input.offset,
    topicId: input.topicId,
  });

  return { ...transcript, topic };
};
