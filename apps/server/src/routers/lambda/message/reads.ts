import { projectToolViewModels } from '@lobechat/tool-view-model';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { cloudWorkspaceAuth } from '@/business/server/trpc-middlewares/workspaceAuth';
import { MessageModel } from '@/database/models/message';
import { TopicShareModel } from '@/database/models/topicShare';
import { publicProcedure } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { FileService } from '@/server/services/file';
import { createFtsSearchRepo } from '@/server/services/ftsSearch';

import {
  assertCanUseTopicTargets,
  assertCanViewMessageTargets,
} from '../_helpers/conversationResourceGuard';
import { projectSharedTopicMessages } from '../_helpers/projectSharedTopicMessages';
import { guardCtx, messageProcedure } from './procedures';

/**
 * Upper bound on rounds per `getMessagesByCursor` page. The scan itself is bounded
 * by `countBudget`; this only lets a caller ask for "as many whole rounds as the
 * budget holds" (the chat window) without an arbitrary value.
 */
const MAX_CURSOR_ROUND_LIMIT = 1000;

/** Upper bound on rows scanned per `getMessagesByCursor` page (the model's default cap). */
const MAX_CURSOR_COUNT_BUDGET = 2000;

const messageSearchProcedure = messageProcedure.use(async (opts) => {
  const { ctx } = opts;
  const workspaceId = ctx.workspaceId ?? undefined;
  const ftsSearchRepo = await createFtsSearchRepo({
    db: ctx.serverDB,
    userId: ctx.userId,
    usage: 'message_search',
    workspaceId,
  });

  return opts.next({
    ctx: {
      messageModel: new MessageModel(ctx.serverDB, ctx.userId, workspaceId, ftsSearchRepo),
    },
  });
});

export const readProcedures = {
  /**
   * Raw tool payload for one message, fetched on demand when the projected
   * read path dropped it (`UIChatMessage.payloadOmitted`).
   */
  /** Bulk form of {@link getToolResultPayload}; see its note on ids as locators. */
  getToolResultPayloads: messageProcedure
    .input(z.object({ messageIds: z.array(z.string()).min(1).max(500) }))
    .query(async ({ input, ctx }) => {
      await assertCanViewMessageTargets(guardCtx(ctx), input.messageIds);

      return ctx.messageService.getToolResultPayloads(input.messageIds);
    }),

  getToolResultPayload: messageProcedure
    .input(z.object({ messageId: z.string() }))
    .query(async ({ input, ctx }) => {
      // A message id is a locator, not an authorization. In a workspace the
      // model reads are workspace-scoped, so without this a member who kept an
      // id could pull tool output from a conversation they cannot open — the
      // same guard `getMessages` applies before returning the list.
      await assertCanViewMessageTargets(guardCtx(ctx), [input.messageId]);

      return ctx.messageService.getToolResultPayload(input.messageId);
    }),

  getMessages: publicProcedure
    .use(cloudWorkspaceAuth)
    .use(serverDatabase)
    .input(
      z.object({
        agentId: z.string().nullish(),
        // Round-cursor for loading older history: only rows strictly older than
        // this (createdAt, id) tuple, round-aligned like page 0. See
        // `QueryMessageParams.before`.
        before: z.object({ createdAt: z.date(), id: z.string() }).optional(),
        current: z.number().optional(),
        groupId: z.string().nullish(),
        // Opt-in for `file` work summaries in the payload. Absent → the legacy
        // set, so already-deployed clients (no `file` descriptor) never receive
        // a `file` summary that would crash their works UI. New clients set it.
        includeFileWorks: z.boolean().optional(),
        pageSize: z.number().optional(),
        /**
         * Hand back render-facing tool view models instead of the stored
         * payloads (`@lobechat/tool-view-model`). Opt-in per read: see the
         * note where it is applied.
         */
        projectToolPayloads: z.boolean().optional(),
        sessionId: z.string().nullish(),
        // Mid-stream refetches skip the Work-summary assembly — see
        // `QueryMessageParams.skipWorks`.
        skipWorks: z.boolean().optional(),
        threadId: z.string().nullish(),
        topicId: z.string().nullish(),
        topicShareId: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { topicShareId, ...queryParams } = input;

      // Public access via topicShareId
      if (topicShareId) {
        const share = await TopicShareModel.findByShareIdWithAccessCheck(
          ctx.serverDB,
          topicShareId,
          ctx.userId ?? undefined,
        );

        // Workspace shares store their workspaceId on the share record; without
        // it the ownership filter degrades to `workspace_id IS NULL` and returns
        // no messages for workspace topics.
        const shareWorkspaceId = share.workspaceId ?? undefined;
        // Legacy `share.topicId` (chat share) is a creator topic. Agent-share
        // visitor topics have their own router (`shareChat.ts`), and this
        // path is only entered when a creator publishes their own conversation
        // via the classic share link — so we do NOT opt into visitor scope.
        const messageModel = new MessageModel(ctx.serverDB, share.ownerId, shareWorkspaceId);
        const fileService = new FileService(ctx.serverDB, share.ownerId, shareWorkspaceId);

        const messages = await messageModel.query(
          // Force skipWorks: Work summaries join LIVE task/version state (not a
          // share-time snapshot), so serving them here would leak post-share
          // mutations to anonymous visitors. Share pages render no Work chips.
          { ...queryParams, skipWorks: true, topicId: share.topicId },
          {
            postProcessUrl: (path, file) =>
              fileService.getFileAccessUrl({ id: file.id, url: path }),
          },
        );

        return projectSharedTopicMessages(messages);
      }

      // Authenticated access - require userId
      if (!ctx.userId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
      }

      // Align with every other topic-scoped procedure in this router: a raw
      // `topicId` from the client must still pass the conversation
      // General-access guard before its messages are read.
      if (queryParams.topicId) {
        await assertCanUseTopicTargets(
          guardCtx({
            serverDB: ctx.serverDB,
            userId: ctx.userId,
            workspaceId: ctx.workspaceId,
          }),
          [queryParams.topicId],
        );
      }

      const wsId = ctx.workspaceId ?? undefined;
      const messageModel = new MessageModel(ctx.serverDB, ctx.userId, wsId);
      const fileService = new FileService(ctx.serverDB, ctx.userId, wsId);

      const messages = await messageModel.query(queryParams, {
        postProcessUrl: (path, file) => fileService.getFileAccessUrl({ id: file.id, url: path }),
      });

      // Only the caller knows whether this list is going to be rendered or fed
      // to a model: a run that executes in the browser assembles its context
      // from the very list this read returns, and a projected tool result would
      // silently disappear from it. Absent ⇒ whole payloads, which is never the
      // answer that loses data.
      return input.projectToolPayloads ? projectToolViewModels(messages) : messages;
    }),

  /**
   * Round-boundary cursor pagination for a topic's mainline conversation. Used by
   * callers that only DISPLAY history (server-runtime / hetero); legacy client
   * mode keeps using `getMessages` (full fetch) because it resends the session.
   * Omit `cursor` for the newest page; pass a prior `nextCursor` to load older.
   */
  getMessagesByCursor: publicProcedure
    .use(cloudWorkspaceAuth)
    .use(serverDatabase)
    .input(
      z.object({
        agentId: z.string().nullish(),
        // Bounded at the API boundary: the model turns this into a row LIMIT, so
        // an unbounded value would let any caller (incl. anonymous share
        // visitors) force an arbitrarily large scan of a long topic.
        countBudget: z.number().int().positive().max(MAX_CURSOR_COUNT_BUDGET).optional(),
        // `createdAt` is cast to `::timestamptz` in SQL, so reject anything that
        // isn't the UTC ISO timestamp `nextCursor` emits (up to microseconds)
        // here — otherwise malformed input surfaces as a Postgres 500.
        cursor: z.object({ createdAt: z.string().datetime(), id: z.string().min(1) }).nullish(),
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
      }),
    )
    .query(async ({ input, ctx }) => {
      const { projectToolPayloads, topicShareId, topicId, ...queryParams } = input;

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
          // Force skipWorks: Work summaries join LIVE task/version state, so serving
          // them here would leak post-share mutations to anonymous visitors.
          { ...queryParams, skipWorks: true, topicId: share.topicId },
          {
            postProcessUrl: (path, file) =>
              fileService.getFileAccessUrl({ id: file.id, url: path }),
          },
        );

        return { ...page, messages: projectSharedTopicMessages(page.messages) };
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
        guardCtx({ serverDB: ctx.serverDB, userId: ctx.userId, workspaceId: ctx.workspaceId }),
        [topicId],
      );

      const wsId = ctx.workspaceId ?? undefined;
      const messageModel = new MessageModel(ctx.serverDB, ctx.userId, wsId);
      const fileService = new FileService(ctx.serverDB, ctx.userId, wsId);

      const page = await messageModel.queryTopicMessagesByCursor(
        { ...queryParams, topicId },
        {
          postProcessUrl: (path, file) => fileService.getFileAccessUrl({ id: file.id, url: path }),
        },
      );

      // Same rule as `getMessages`: only the caller knows whether this page is
      // rendered or fed to a model, so projection is opt-in per read.
      return projectToolPayloads
        ? { ...page, messages: projectToolViewModels(page.messages) }
        : page;
    }),

  searchMessages: messageSearchProcedure
    .input(z.object({ keywords: z.string() }))
    .query(async ({ input, ctx }) => {
      return ctx.messageModel.queryByKeyword(input.keywords);
    }),
};
