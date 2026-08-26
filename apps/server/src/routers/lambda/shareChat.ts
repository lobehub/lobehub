import { ChatErrorType, entityIdPattern, RequestTrigger } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { z } from 'zod';

import { getAgentShareBudgetRemaining } from '@/business/server/agent-share/agentShareBudgetGate';
import { AgentShareModel } from '@/database/models/agentShare';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { signUserJWT } from '@/libs/trpc/utils/internalJwt';
import { AiAgentService } from '@/server/services/aiAgent';
import type { AgentShareGate } from '@/server/services/aiAgent/shareGate';
import { FileService } from '@/server/services/file';

const log = debug('lobe-server:router:shareChat');

/**
 * Visitor-facing execution chain for shared agents (Agent Share).
 *
 * All procedures authenticate the VISITOR (ctx.userId) but operate on
 * CREATOR-owned rows: topics/messages of a share conversation carry the
 * creator's userId (so runtime, billing, and tool paths behave exactly as a
 * creator-owned chat) plus `topics.senderId = visitor` for scoping. Every
 * read/write here is therefore manually authorized: resolve the share via
 * `findByShareIdWithAccessCheck`, then require `topic.senderId === visitor`.
 *
 * Agent sharing is personal-only (workspace agents cannot be shared), so no
 * workspaceId is ever threaded into the creator-scoped models/services.
 */
const shareChatProcedure = authedProcedure.use(serverDatabase);

const ShareTopicScopeSchema = z.object({
  shareId: z.string(),
  topicId: z.string(),
});

/**
 * Resolve a visitor-owned share topic or fail closed. The topic row belongs to
 * the creator (creator-scoped TopicModel), so the senderId + agentId match is
 * the ONLY thing standing between a visitor and the creator's other topics.
 */
const findVisitorTopicOrThrow = async (
  topicModel: TopicModel,
  params: { agentId: string; topicId: string; visitorUserId: string },
) => {
  const topic = await topicModel.findById(params.topicId);

  if (!topic || topic.senderId !== params.visitorUserId || topic.agentId !== params.agentId) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Topic not found' });
  }

  return topic;
};

export const shareChatRouter = router({
  /**
   * Execute a shared agent as a visitor — the gateway-transport mirror of
   * `aiAgent.execAgent`, restricted to the share surface: fixed agent, no
   * device/local targets, share-config tool whitelist, per-visitor caps.
   */
  execAgent: shareChatProcedure
    .input(
      z.object({
        /** Client-minted row ids, honoured verbatim (see aiAgent.execAgent). */
        clientIds: z
          .object({
            assistantMessageId: z.string().regex(entityIdPattern('messages')).optional(),
            topicId: z.string().regex(entityIdPattern('topics')).optional(),
            userMessageId: z.string().regex(entityIdPattern('messages')).optional(),
          })
          .optional(),
        prompt: z.string(),
        shareId: z.string(),
        /** Absent → the run creates a new visitor topic (counted against the topic cap). */
        topicId: z.string().nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const share = await AgentShareModel.findByShareIdWithAccessCheck(
        ctx.serverDB,
        input.shareId,
        ctx.userId,
      );

      // Budget precheck BEFORE any row is created: the runtime billing gate
      // would reject the run anyway (mid-run, after the topic and placeholder
      // messages persisted), leaving junk topics with a "..." assistant row.
      const budgetRemaining = await getAgentShareBudgetRemaining({ agentId: share.agentId });
      if (budgetRemaining !== null && budgetRemaining <= 0) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: ChatErrorType.InsufficientBudgetForModel,
        });
      }

      const { maxTopicsPerVisitor, maxTurnsPerTopic } = share.shareConfig;
      const topicModel = new TopicModel(ctx.serverDB, share.ownerId);
      const messageModel = new MessageModel(ctx.serverDB, share.ownerId);

      // Double caps, checked before dispatch so a blocked run never bills.
      if (input.topicId) {
        await findVisitorTopicOrThrow(topicModel, {
          agentId: share.agentId,
          topicId: input.topicId,
          visitorUserId: ctx.userId,
        });

        // `messageModel.count()` excludes agent-share visitor messages by
        // design (personal analytics predicate) — see `countByTopic` JSDoc
        // for why the turn cap must use the exact per-topic counter instead.
        const turnCount = await messageModel.countByTopic({
          role: 'user',
          topicId: input.topicId,
        });
        if (turnCount >= maxTurnsPerTopic) {
          throw new TRPCError({
            code: 'TOO_MANY_REQUESTS',
            message: ChatErrorType.ShareTurnLimitExceeded,
          });
        }
      } else {
        const topicCount = await topicModel.countBySender({
          agentId: share.agentId,
          senderId: ctx.userId,
        });
        if (topicCount >= maxTopicsPerVisitor) {
          throw new TRPCError({
            code: 'TOO_MANY_REQUESTS',
            message: ChatErrorType.ShareTopicLimitExceeded,
          });
        }
      }

      // Creator-scoped service: the run executes under the creator's identity
      // (their agent config, connectors, billing context). The shareGate strips
      // everything the share config doesn't grant; `agentShare` billing context
      // routes model spend to the creator's share budget.
      const shareGate: AgentShareGate = {
        agentId: share.agentId,
        shareConfig: share.shareConfig,
        visitorUserId: ctx.userId,
      };

      // Creator's Market access token, mirroring aiAgentProcedure — server-side
      // tool runtime authenticates against the Market API with it.
      let marketAccessToken: string | undefined;
      try {
        const userModel = new UserModel(ctx.serverDB, share.ownerId);
        const settings = await userModel.getUserSettings();
        marketAccessToken = (settings?.market as any)?.accessToken;
      } catch {
        // non-fatal — MarketService falls back to trustedClientToken
      }

      const aiAgentService = new AiAgentService(ctx.serverDB, share.ownerId, {
        marketAccessToken,
      });

      log('execAgent: share=%s visitor=%s topic=%s', input.shareId, ctx.userId, input.topicId);

      try {
        return await aiAgentService.execAgent({
          agentId: share.agentId,
          appContext: { topicId: input.topicId },
          clientIds: input.clientIds,
          clientIp: ctx.clientIp ?? undefined,
          interactiveStart: true,
          prompt: input.prompt,
          shareGate,
          trigger: RequestTrigger.Chat,
          userAgent: ctx.userAgent ?? undefined,
        });
      } catch (error: any) {
        if (error instanceof TRPCError) throw error;

        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to execute shared agent: ${error.message}`,
        });
      }
    }),

  /** Messages of one visitor-owned share topic. */
  getMessages: shareChatProcedure.input(ShareTopicScopeSchema).query(async ({ input, ctx }) => {
    const share = await AgentShareModel.findByShareIdWithAccessCheck(
      ctx.serverDB,
      input.shareId,
      ctx.userId,
    );

    const topicModel = new TopicModel(ctx.serverDB, share.ownerId);
    await findVisitorTopicOrThrow(topicModel, {
      agentId: share.agentId,
      topicId: input.topicId,
      visitorUserId: ctx.userId,
    });

    const messageModel = new MessageModel(ctx.serverDB, share.ownerId);
    const fileService = new FileService(ctx.serverDB, share.ownerId);

    return messageModel.query(
      // skipWorks: Work summaries join live task/version state of the
      // CREATOR's account — never serve them to a visitor surface.
      { skipWorks: true, topicId: input.topicId },
      {
        postProcessUrl: (path, file) => fileService.getFileAccessUrl({ id: file.id, url: path }),
      },
    );
  }),

  /** The visitor's own topics on this shared agent. */
  getTopics: shareChatProcedure
    .input(z.object({ shareId: z.string() }))
    .query(async ({ input, ctx }) => {
      const share = await AgentShareModel.findByShareIdWithAccessCheck(
        ctx.serverDB,
        input.shareId,
        ctx.userId,
      );

      const topicModel = new TopicModel(ctx.serverDB, share.ownerId);
      return topicModel.queryBySender({ agentId: share.agentId, senderId: ctx.userId });
    }),

  /**
   * Refresh the Gateway WS JWT for a running share operation — the visitor
   * counterpart of `aiAgent.refreshGatewayToken` (which cannot serve visitors:
   * its TopicModel is scoped to the caller, and share topics belong to the
   * creator). Signs for the VISITOR — the gateway channel is registered under
   * their id (`streamOwnerUserId`), and a creator-signed token in the
   * visitor's browser would be creator account access.
   */
  refreshGatewayToken: shareChatProcedure
    .input(ShareTopicScopeSchema)
    .query(async ({ input, ctx }) => {
      const share = await AgentShareModel.findByShareIdWithAccessCheck(
        ctx.serverDB,
        input.shareId,
        ctx.userId,
      );

      const topicModel = new TopicModel(ctx.serverDB, share.ownerId);
      const topic = await findVisitorTopicOrThrow(topicModel, {
        agentId: share.agentId,
        topicId: input.topicId,
        visitorUserId: ctx.userId,
      });

      if (!topic.metadata?.runningOperation) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No running operation found on this topic',
        });
      }

      const token = await signUserJWT(ctx.userId);

      return { token };
    }),
});

export type ShareChatRouter = typeof shareChatRouter;
