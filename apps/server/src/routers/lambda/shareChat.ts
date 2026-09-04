import {
  AGENT_SHARE_DEFAULT_MAX_TOPICS_PER_VISITOR,
  AGENT_SHARE_DEFAULT_MAX_TURNS_PER_TOPIC,
  SHARE_VISITOR_PROMPT_MAX_LENGTH,
} from '@lobechat/const';
import type { ChatMessageError } from '@lobechat/types';
import { ChatErrorType, entityIdPattern, RequestTrigger } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { z } from 'zod';

import { checkAgentShareSpendAllowance } from '@/business/server/agent-share/spendGate';
import { AgentShareModel } from '@/database/models/agentShare';
import { MessageModel, sanitizeVisitorError } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { signUserJWT } from '@/libs/trpc/utils/internalJwt';
import { AiAgentService } from '@/server/services/aiAgent';
import type { AgentShareGate } from '@/server/services/aiAgent/shareGate';
import { FileService } from '@/server/services/file';

import { assertAgentShareVisitorEnabled } from './_helpers/agentShareFeatureGate';

const log = debug('lobe-server:router:shareChat');

/**
 * Visitor-facing execution chain for shared agents (Agent Share).
 *
 * All procedures authenticate the VISITOR (ctx.userId) but operate on
 * CREATOR-owned rows: topics/messages of a share conversation carry the
 * creator's userId (so runtime, billing, and tool paths behave exactly as a
 * creator-owned chat) plus `topics.senderId = visitor` for scoping. Every
 * read/write here is therefore manually authorized: resolve the share via
 * {@link resolveLinkShareOrThrow}, then require
 * `topic.senderId === visitor && topic.agentId === share.agentId`
 * ({@link findVisitorTopicOrThrow}).
 *
 * There is no share-instance column on `topics`: a visitor topic is tied to
 * its share purely through `(agentId, senderId)`, which is unambiguous because
 * `agent_shares` is 1:1 per agent. The known consequence is that a visitor's
 * own older topics resurface after an owner disables and re-enables the share
 * (a pause that keeps the same row, so nothing marks the topics as belonging
 * to an earlier run of it). That crosses no identity boundary — it is the same
 * visitor's own prior conversation with the same agent — but it does mean the
 * per-visitor topic cap counts them.
 *
 * Agent sharing is personal-only (workspace agents cannot be shared), so no
 * workspaceId is ever threaded into the creator-scoped models/services.
 */
const shareChatProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  // Availability gate for the VISITOR side of Agent Share (see
  // `_helpers/agentShareFeatureGate.ts`): `ENABLE_BUSINESS_FEATURES`
  // (compile-time, false in OSS) AND the `enableAgentShare` grayscale flag,
  // both evaluated for the VISITOR calling in — never the share owner,
  // who reaches their own agent through `aiAgent.execAgent`, not this router.
  await assertAgentShareVisitorEnabled(opts.ctx.userId);

  return opts.next();
});

const ShareTopicScopeSchema = z.object({
  shareId: z.string(),
  topicId: z.string(),
});

/**
 * Resolve a share for the VISITOR execution path.
 *
 * Stricter than the plain `findByShareIdWithAccessCheck` used by the read-only
 * share page: that helper deliberately lets the OWNER through on a `private`
 * share (so they can preview their own unpublished page), but the owner never
 * uses this visitor chain — they chat with their own agent through
 * `aiAgent.execAgent`. Requiring `link` here keeps this entry point in exact
 * agreement with the per-step revalidation
 * (`AgentShareModel.isRunStillAuthorized`, which also demands `link`), so a
 * run can never be authorized to start under a rule its own step loop would
 * immediately abort it for.
 */
const resolveLinkShareOrThrow = async (db: LobeChatDatabase, shareId: string, viewerId: string) => {
  const share = await AgentShareModel.findByShareIdWithAccessCheck(db, shareId, viewerId);

  if (share.visibility !== 'link') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'This share is private' });
  }

  return share;
};

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

/**
 * Convert an internal startup failure into a visitor-safe `TRPCError` — reuses
 * `sanitizeVisitorError` (`packages/database/src/models/message.ts`) instead of
 * a third ad-hoc redaction. `execAgent`/`interruptTask` can throw BEFORE any
 * Gateway streaming starts (e.g. the queue or runtime backend returns a
 * diagnostic), a failure surface neither existing visitor projection covers —
 * `toVisitorMessage` only runs over persisted rows and the Gateway event
 * sanitizer only runs over live stream events — so without this, the raw
 * `error.message` (which can carry the creator's provider/infra diagnostic,
 * since the run executes under the CREATOR's identity) went straight to the
 * visitor. Logs the raw error server-side and returns only the classified
 * `{ type }` (or `{ message }` for the narrow allowlisted codes) that
 * `sanitizeVisitorError` already deems visitor-safe.
 *
 * `showErrorDetails` (the owner's opt-in on the share config) bypasses the
 * projection, exactly as it does for persisted rows and live stream events.
 *
 * Also the sink for a RESOLVED (not thrown) `{ success: false, error }` from
 * `AiAgentService.execAgent` — a `createOperation` startup failure resolves
 * rather than rejects there, so the visitor-facing `execAgent` handler below
 * re-throws that case through this same function instead of letting the raw
 * message escape via a normal `return`.
 */
const toVisitorSafeStartupError = (
  context: string,
  error: unknown,
  options: { showErrorDetails?: boolean } = {},
): TRPCError => {
  log('%s failed: %O', context, error);

  const raw = error as { message?: unknown; type?: unknown } | null | undefined;
  const safe = sanitizeVisitorError(
    raw && typeof raw === 'object'
      ? ({
          message: typeof raw.message === 'string' ? raw.message : undefined,
          type: raw.type,
        } as ChatMessageError)
      : undefined,
    options,
  );

  // `type` widens to `string | number` (the numeric HTTP-status error codes),
  // while `TRPCError.message` is `string | undefined` — stringify rather than
  // drop the numeric codes, which are exactly as visitor-safe as the rest.
  const publicMessage = safe?.message ?? safe?.type;

  return new TRPCError({
    cause: error,
    code: 'INTERNAL_SERVER_ERROR',
    message: publicMessage === undefined ? 'Internal error' : String(publicMessage),
  });
};

export const shareChatRouter = router({
  /**
   * Execute a shared agent as a visitor — the gateway-transport mirror of
   * `aiAgent.execAgent`, restricted to the share surface: fixed agent, no
   * device/local targets, share-config tool allowlist, per-visitor caps.
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
        /** See `SHARE_VISITOR_PROMPT_MAX_LENGTH`'s JSDoc for the size-bound rationale. */
        prompt: z.string().max(SHARE_VISITOR_PROMPT_MAX_LENGTH),
        shareId: z.string(),
        /** Absent → the run creates a new visitor topic (counted against the topic cap). */
        topicId: z.string().nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const share = await resolveLinkShareOrThrow(ctx.serverDB, input.shareId, ctx.userId);

      // Spend admission runs FIRST, before any row is created: a run rejected
      // by the runtime billing path instead fails mid-run, after the topic and
      // placeholder messages have persisted, leaving junk topics with a "..."
      // assistant row. No-op in deployments that do not meter share spend.
      const spendGate = await checkAgentShareSpendAllowance({
        agentId: share.agentId,
        monthlySpendLimit: share.shareConfig.monthlySpendLimit,
        ownerUserId: share.ownerId,
        shareId: share.shareId,
        visitorUserId: ctx.userId,
      });
      if (!spendGate.allowed) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: ChatErrorType.ShareSpendLimitExceeded,
        });
      }

      // Runtime-normalized (findByShareIdWithAccessCheck fills defaults), but
      // the config TYPE keeps every field optional — re-apply the same default
      // constants rather than asserting non-null.
      const maxTopicsPerVisitor =
        share.shareConfig.maxTopicsPerVisitor ?? AGENT_SHARE_DEFAULT_MAX_TOPICS_PER_VISITOR;
      const maxTurnsPerTopic =
        share.shareConfig.maxTurnsPerTopic ?? AGENT_SHARE_DEFAULT_MAX_TURNS_PER_TOPIC;
      const topicModel = new TopicModel(ctx.serverDB, share.ownerId, undefined, undefined, {
        includeShareVisitor: true,
      });
      const messageModel = new MessageModel(ctx.serverDB, share.ownerId, undefined, undefined, {
        includeShareVisitor: true,
      });

      // Fast, UX-only pre-check for both caps: reject an obviously-over-cap
      // request BEFORE paying for agent-config/tool resolution, instead of only
      // at dispatch. This is NOT the enforcement: it is a plain unlocked count,
      // so a burst of concurrent requests can all read the same pre-insert
      // count and all pass. The atomic, authoritative gate is
      // `reserveShareVisitorTopicOrThrow` / `reserveShareVisitorTurnOrThrow`
      // (`apps/server/src/services/aiAgent/shareVisitorAbuseGuards.ts`), which
      // locks and re-checks the same counters immediately around the real
      // topic/message INSERT inside `AiAgentService.execAgent`.
      if (input.topicId) {
        await findVisitorTopicOrThrow(topicModel, {
          agentId: share.agentId,
          topicId: input.topicId,
          visitorUserId: ctx.userId,
        });

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
      // everything the share config doesn't grant.
      const shareGate: AgentShareGate = {
        agentId: share.agentId,
        shareConfig: share.shareConfig,
        // See `AgentShareGate.shareId`'s JSDoc — the share instance this run is
        // authorized against, and the token every later revalidation compares.
        shareId: share.shareId,
        visitorUserId: ctx.userId,
      };

      // Creator's Market access token, mirroring aiAgentProcedure — the
      // server-side tool runtime authenticates against the Market API with it.
      let marketAccessToken: string | undefined;
      try {
        const userModel = new UserModel(ctx.serverDB, share.ownerId);
        const settings = await userModel.getUserSettings();
        marketAccessToken = (settings?.market as any)?.accessToken;
      } catch {
        // non-fatal — MarketService falls back to trustedClientToken
      }

      const aiAgentService = new AiAgentService(ctx.serverDB, share.ownerId, {
        // Share visitor turns persist under the creator's `userId` — the
        // service's internal `messageModel`/`topicModel`/runtime must be
        // constructed with the visitor scope so reads/writes on
        // `topics.senderId <> NULL` rows aren't filtered out.
        includeShareVisitor: true,
        marketAccessToken,
      });

      log('execAgent: share=%s visitor=%s topic=%s', input.shareId, ctx.userId, input.topicId);

      try {
        const result = await aiAgentService.execAgent({
          agentId: share.agentId,
          appContext: { topicId: input.topicId },
          clientIds: input.clientIds,
          clientIp: ctx.clientIp ?? undefined,
          // `interactiveStart: true` (the `aiAgent.execAgent` owner path's
          // default) makes `TopicModel.tryReserveTaskCallback` skip its
          // `runningOperation` liveness check entirely — a policy that is safe
          // there ONLY because the owner's OWN client serializes sends.
          //
          // An untrusted visitor has no such client-side gate: firing two
          // concurrent `execAgent` mutations for the SAME topic would let both
          // pass the reservation (each only contends on the short-lived
          // `taskCallbackReservation`, released right after the first operation
          // is CREATED, long before it finishes streaming), so both would
          // create creator-credentialed operations. The second operation's
          // `runningOperation` marker write then overwrites the first's,
          // leaving the first unreachable by `shareChat.interruptTask` (which
          // matches on the topic's current marker) — an orphaned run that keeps
          // using tools and the creator's budget until it finishes on its own.
          //
          // Leaving this `false` routes visitor sends through the SAME
          // liveness-checked reservation every non-interactive start uses: a
          // second concurrent send for a topic with a live operation is
          // rejected instead of silently displacing the first.
          interactiveStart: false,
          prompt: input.prompt,
          shareGate,
          // Not `RequestTrigger.Chat`: a share run is billed to the CREATOR,
          // so its spend rows must be separable from the creator's own chat
          // spend (they land on the same account). The trigger rides
          // `state.metadata.trigger` all the way into the spend-log metadata.
          trigger: RequestTrigger.AgentShare,
          userAgent: ctx.userAgent ?? undefined,
        });

        // `AiAgentService.execAgent` RESOLVES (does not throw) when
        // `createOperation` itself fails to start (e.g. the queue/runtime
        // backend is unavailable). That `error` is the same raw
        // `error.message` the thrown path guards against, so it must go through
        // the exact same projection instead of reaching the visitor verbatim.
        //
        // Reject rather than sanitize-and-return: the Gateway client never
        // checks `result.success` — it unconditionally treats the resolved
        // value as a live operation and connects with its
        // `operationId`/`token`. A sanitized `success: false` object would
        // still be consumed as if the run started, opening a WebSocket for an
        // operation that never began.
        if (!result.success) {
          throw toVisitorSafeStartupError(
            'execAgent',
            { message: result.error },
            { showErrorDetails: share.shareConfig.showErrorDetails },
          );
        }

        return result;
      } catch (error: any) {
        if (error instanceof TRPCError) throw error;

        throw toVisitorSafeStartupError('execAgent', error, {
          showErrorDetails: share.shareConfig.showErrorDetails,
        });
      }
    }),

  /** Messages of one visitor-owned share topic. */
  getMessages: shareChatProcedure.input(ShareTopicScopeSchema).query(async ({ input, ctx }) => {
    const share = await resolveLinkShareOrThrow(ctx.serverDB, input.shareId, ctx.userId);

    const topicModel = new TopicModel(ctx.serverDB, share.ownerId, undefined, undefined, {
      includeShareVisitor: true,
    });
    await findVisitorTopicOrThrow(topicModel, {
      agentId: share.agentId,
      topicId: input.topicId,
      visitorUserId: ctx.userId,
    });

    const messageModel = new MessageModel(ctx.serverDB, share.ownerId, undefined, undefined, {
      includeShareVisitor: true,
    });
    const fileService = new FileService(ctx.serverDB, share.ownerId);

    // queryForVisitor strips the creator's `sender` identity, and — unless the
    // share opts in via `showModelInfo` / `showErrorDetails` — the spend/model
    // snapshot and raw error payload too. Share messages persist under the
    // CREATOR's account (see the module doc above), so the raw `query()` result
    // would otherwise leak the creator's account identity to the visitor.
    return messageModel.queryForVisitor(
      // skipWorks: Work summaries join live task/version state of the CREATOR's
      // account — never serve them to a visitor surface.
      { skipWorks: true, topicId: input.topicId },
      {
        postProcessUrl: (path, file) => fileService.getFileAccessUrl({ id: file.id, url: path }),
        redaction: {
          showErrorDetails: share.shareConfig.showErrorDetails,
          showModelInfo: share.shareConfig.showModelInfo,
        },
      },
    );
  }),

  /** The visitor's own topics on this shared agent. */
  getTopics: shareChatProcedure
    .input(z.object({ shareId: z.string() }))
    .query(async ({ input, ctx }) => {
      const share = await resolveLinkShareOrThrow(ctx.serverDB, input.shareId, ctx.userId);

      // The list is intentionally NOT bounded by the share's live
      // `maxTopicsPerVisitor`: that cap gates ADMISSION of new topics (the
      // COUNT check in `execAgent` above), and a creator may lower it below
      // what a visitor already created. Tying the page size to it would hide
      // those older conversations with no pagination or deep link to reach
      // them, so the model applies its own fixed, generous list bound instead.
      const topicModel = new TopicModel(ctx.serverDB, share.ownerId, undefined, undefined, {
        includeShareVisitor: true,
      });
      return topicModel.queryBySender({
        agentId: share.agentId,
        senderId: ctx.userId,
      });
    }),

  /**
   * Interrupt a running share operation — the visitor counterpart of
   * `aiAgent.interruptTask`. Visitors have no owner-scoped access to
   * `aiAgent.interruptTask` (its models are scoped to the caller, and share
   * runs execute under the CREATOR's identity), so without this endpoint a
   * visitor's Stop / tab-close cannot reach the server: the run keeps streaming
   * and consuming the creator's budget until it finishes on its own.
   *
   * Authorization is intentionally stricter than `execAgent`/`getMessages`: it
   * is not enough that the topic belongs to this visitor — the `operationId`
   * must also match the operation CURRENTLY recorded as running on that topic.
   * Without that check a visitor could pass an arbitrary operationId
   * (topics/operations are creator-owned rows) and interrupt an unrelated run
   * on the creator's account.
   */
  interruptTask: shareChatProcedure
    .input(ShareTopicScopeSchema.extend({ operationId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const share = await resolveLinkShareOrThrow(ctx.serverDB, input.shareId, ctx.userId);

      const topicModel = new TopicModel(ctx.serverDB, share.ownerId, undefined, undefined, {
        includeShareVisitor: true,
      });
      const topic = await findVisitorTopicOrThrow(topicModel, {
        agentId: share.agentId,
        topicId: input.topicId,
        visitorUserId: ctx.userId,
      });

      const runningOperationId = topic.metadata?.runningOperation?.operationId;
      if (!runningOperationId || runningOperationId !== input.operationId) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No matching running operation found on this topic',
        });
      }

      // Creator-scoped service, same as `execAgent` — the run's operation /
      // thread rows were written under the creator's identity, so the
      // underlying `interruptTask` implementation must resolve them there.
      const aiAgentService = new AiAgentService(ctx.serverDB, share.ownerId, {
        includeShareVisitor: true,
      });

      log(
        'interruptTask: share=%s visitor=%s topic=%s operation=%s',
        input.shareId,
        ctx.userId,
        input.topicId,
        input.operationId,
      );

      try {
        return await aiAgentService.interruptTask({
          operationId: input.operationId,
          topicId: input.topicId,
        });
      } catch (error: any) {
        if (error instanceof TRPCError) throw error;

        throw toVisitorSafeStartupError('interruptTask', error, {
          showErrorDetails: share.shareConfig.showErrorDetails,
        });
      }
    }),

  /**
   * Refresh the Gateway WS JWT for a running share operation — the visitor
   * counterpart of `aiAgent.refreshGatewayToken` (which cannot serve visitors:
   * its TopicModel is scoped to the caller, and share topics belong to the
   * creator). Signs for the VISITOR — the gateway channel is registered under
   * their id (`streamOwnerUserId`), and a creator-signed token in the visitor's
   * browser would be creator account access.
   */
  refreshGatewayToken: shareChatProcedure
    .input(ShareTopicScopeSchema)
    .query(async ({ input, ctx }) => {
      const share = await resolveLinkShareOrThrow(ctx.serverDB, input.shareId, ctx.userId);

      const topicModel = new TopicModel(ctx.serverDB, share.ownerId, undefined, undefined, {
        includeShareVisitor: true,
      });
      const topic = await findVisitorTopicOrThrow(topicModel, {
        agentId: share.agentId,
        topicId: input.topicId,
        visitorUserId: ctx.userId,
      });

      // A present marker is not proof of a live run: it is cleared best-effort
      // at finish, so a stale one would send the visitor's browser to reconnect
      // to a finished operation, register it as "running" locally, and drop the
      // topic's fetched history as in-flight noise (a frozen skeleton list).
      // NOT_FOUND is what the client already treats as "stale marker, clear it".
      const runningOperation = topic.metadata?.runningOperation;
      if (
        !runningOperation ||
        !(await topicModel.isRunningOperationAlive(ctx.serverDB, runningOperation))
      ) {
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
