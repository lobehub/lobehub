import { projectToolViewModels } from '@lobechat/tool-view-model';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { MessageModel } from '@/database/models/message';
import { TopicShareModel } from '@/database/models/topicShare';
import type { LobeChatDatabase } from '@/database/type';
import { FileService } from '@/server/services/file';

import {
  assertCanUseConversationTargets,
  assertCanUseTopicTargets,
} from './conversationResourceGuard';
import { projectSharedTopicMessages } from './projectSharedTopicMessages';
import { resolveContext } from './resolveContext';

/**
 * Upper bound on rounds per `getMessagesByCursor` page. The scan itself is bounded
 * by `countBudget`; this only lets a caller ask for "as many whole rounds as the
 * budget holds" (the chat window) without an arbitrary value.
 */
const MAX_CURSOR_ROUND_LIMIT = 1000;
/** Upper bound on rows scanned per `getMessagesByCursor` page (the model's default cap). */
const MAX_CURSOR_COUNT_BUDGET = 2000;

export const messagesByCursorInputSchema = z.object({
  agentId: z.string().nullish(),
  // Bounded at the API boundary: the model turns this into a row LIMIT, so
  // an unbounded value would let any caller (incl. anonymous share
  // visitors) force an arbitrarily large scan of a long topic.
  countBudget: z.number().int().positive().max(MAX_CURSOR_COUNT_BUDGET).optional(),
  // `createdAt` is cast to `::timestamptz` in SQL, so reject anything that
  // isn't the UTC ISO timestamp `nextCursor` emits (up to microseconds)
  // here — otherwise malformed input surfaces as a Postgres 500.
  cursor: z.object({ createdAt: z.string().datetime(), id: z.string().min(1) }).nullish(),
  direction: z.enum(['backward', 'forward']).optional(),
  groupId: z.string().nullish(),
  // Same opt-in as `getMessages`: only clients that ship the `file` work
  // descriptor ask for `file` work summaries.
  includeFileWorks: z.boolean().optional(),
  /** Same opt-in as `getMessages`: render-facing tool view models. */
  projectToolPayloads: z.boolean().optional(),
  roundLimit: z.number().int().positive().max(MAX_CURSOR_ROUND_LIMIT).optional(),
  sessionId: z.string().nullish(),
  skipWorks: z.boolean().optional(),
  // Optional so share-link callers can page with only `topicShareId`; the
  // share record supplies the authoritative topic. Required otherwise.
  topicId: z.string().nullish(),
  topicShareId: z.string().optional(),
});

interface MessagesByCursorContext {
  serverDB: LobeChatDatabase;
  userId?: string | null;
  workspaceId?: string | null;
}

/**
 * One cursor page of a topic's mainline. The response echoes the direction it
 * was read in: a server that predates `direction` strips the input and answers
 * with the newest page, and a forward reader must be able to tell.
 */
export const readMessagesByCursor = async (
  ctx: MessagesByCursorContext,
  input: z.infer<typeof messagesByCursorInputSchema>,
) => {
  const {
    direction = 'backward',
    projectToolPayloads,
    topicShareId,
    topicId,
    ...queryParams
  } = input;

  // Public access via topicShareId
  if (topicShareId) {
    const share = await TopicShareModel.findByShareIdWithAccessCheck(
      ctx.serverDB,
      topicShareId,
      ctx.userId ?? undefined,
    );

    // Same scoping as `getMessages`: workspace shares carry their workspaceId,
    // and the classic share link is a creator topic (no visitor scope).
    const shareWorkspaceId = share.workspaceId ?? undefined;
    const messageModel = new MessageModel(ctx.serverDB, share.ownerId, shareWorkspaceId);
    const fileService = new FileService(ctx.serverDB, share.ownerId, shareWorkspaceId);

    const page = await messageModel.queryTopicMessagesByCursor(
      {
        ...queryParams,
        direction,
        // The share record already names the topic's group, so a share link
        // reads with only its id.
        groupId: queryParams.groupId === undefined ? share.groupId : queryParams.groupId,
        // Force skipWorks: Work summaries join LIVE task/version state, so serving
        // them here would leak post-share mutations to anonymous visitors.
        skipWorks: true,
        topicId: share.topicId,
      },
      {
        postProcessUrl: (path, file) => fileService.getFileAccessUrl({ id: file.id, url: path }),
      },
    );

    return { ...page, direction, messages: projectSharedTopicMessages(page.messages) };
  }

  // Authenticated access - require userId
  if (!ctx.userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
  }

  if (!topicId) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'topicId is required' });
  }

  // Same General-access guard `getMessages` applies to a raw client topicId.
  await assertCanUseTopicTargets(
    { db: ctx.serverDB, userId: ctx.userId, workspaceId: ctx.workspaceId },
    [topicId],
  );

  const wsId = ctx.workspaceId ?? undefined;
  const messageModel = new MessageModel(ctx.serverDB, ctx.userId, wsId);
  const fileService = new FileService(ctx.serverDB, ctx.userId, wsId);

  const resolved = await resolveContext(
    { ...queryParams, agentId: queryParams.agentId ?? undefined },
    ctx.serverDB,
    ctx.userId,
    wsId,
  );
  await assertCanUseConversationTargets(
    { db: ctx.serverDB, userId: ctx.userId, workspaceId: wsId },
    [resolved],
  );
  const page = await messageModel.queryTopicMessagesByCursor(
    { ...queryParams, ...resolved, direction, topicId },
    {
      postProcessUrl: (path, file) => fileService.getFileAccessUrl({ id: file.id, url: path }),
    },
  );

  // Same rule as `getMessages`: only the caller knows whether this page is
  // rendered or fed to a model, so projection is opt-in per read.
  return projectToolPayloads
    ? { ...page, direction, messages: projectToolViewModels(page.messages) }
    : { ...page, direction };
};
