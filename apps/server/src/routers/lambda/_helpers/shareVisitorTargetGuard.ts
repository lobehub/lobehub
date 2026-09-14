import { TRPCError } from '@trpc/server';

import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';

interface ShareVisitorGuardCtx {
  db: LobeChatDatabase;
  userId: string;
  workspaceId?: string | null;
}

/**
 * Agent-share visitor conversations are stored under the CREATOR's `userId`
 * (billing/data attribution) with `topics.senderId` set to the visitor, so a
 * plain ownership predicate matches them. A creator who obtains a raw visitor
 * topic/message id out of band (data export, a shared screenshot, …) could
 * otherwise mutate a conversation `allowCreatorViewSessions=false` is meant to
 * hide.
 *
 * ## Why the guard lives here and not in the model defaults
 *
 * The update methods these guards protect (`MessageModel.update`,
 * `updateMessagePlugin`, `updateMetadata`, `updatePluginState`, `updateTTS`,
 * `updateTranslate`, `TopicModel.update`) are also the write path for
 * legitimate in-flight VISITOR turns: `ServerMessageTransport`,
 * `HeterogeneousPersistenceHandler`, `services/aiAgent/*`,
 * `agentRuntime/CompletionLifecycle`, `AbandonOperationService` and friends all
 * persist a visitor's streaming turn under the creator's identity through the
 * very same methods. Flipping the model defaults to exclude visitor rows would
 * silently break live share streaming, and threading an opt-in flag through
 * ~15 runtime call sites is far easier to get wrong than gating the handful of
 * creator-facing RPC entry points. Delete paths differ: those genuinely default
 * to excluding visitors (`ShareVisitorWriteOptions.includeShareVisitor`),
 * because only a few runtime cleanups delete.
 *
 * `NOT_FOUND` (never `FORBIDDEN`) is thrown on purpose: the response must not
 * confirm that the row exists.
 */
const assertNoVisitorTargets = (visitorIds: string[], kind: 'message' | 'topic') => {
  if (visitorIds.length === 0) return;

  throw new TRPCError({
    code: 'NOT_FOUND',
    message: `${kind === 'message' ? 'Message' : 'Topic'} not found`,
  });
};

/**
 * Reject creator-facing writes that target an agent-share visitor message.
 * See the module note above for why this sits at the RPC entry point.
 */
export const assertCreatorMessageTargets = async (
  ctx: ShareVisitorGuardCtx,
  messageIds: string[],
) => {
  const ids = messageIds.filter(Boolean);
  if (ids.length === 0) return;

  const messageModel = new MessageModel(ctx.db, ctx.userId, ctx.workspaceId ?? undefined);

  assertNoVisitorTargets(await messageModel.findShareVisitorMessageIds(ids), 'message');
};

/**
 * Topic twin of {@link assertCreatorMessageTargets}.
 */
export const assertCreatorTopicTargets = async (ctx: ShareVisitorGuardCtx, topicIds: string[]) => {
  const ids = topicIds.filter(Boolean);
  if (ids.length === 0) return;

  const topicModel = new TopicModel(ctx.db, ctx.userId, ctx.workspaceId ?? undefined);

  assertNoVisitorTargets(await topicModel.findShareVisitorTopicIds(ids), 'topic');
};
