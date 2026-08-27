import { SHARE_VISITOR_PROMPT_MAX_LENGTH } from '@lobechat/const';
import type { ChatMessageError } from '@lobechat/types';
import { ChatErrorType, entityIdPattern, RequestTrigger } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { z } from 'zod';

import { getAgentShareBudgetRemaining } from '@/business/server/agent-share/agentShareBudgetGate';
import { AgentShareModel } from '@/database/models/agentShare';
import { MessageModel, sanitizeVisitorError } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import type { AgentShareConfig } from '@/database/schemas';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { signUserJWT } from '@/libs/trpc/utils/internalJwt';
import { AiAgentService } from '@/server/services/aiAgent';
import type { AgentShareGate } from '@/server/services/aiAgent/shareGate';
import {
  createDelegatedPrincipal,
  type ExecutionPrincipal,
} from '@/server/services/executionPrincipal';
import { FileService } from '@/server/services/file';

const log = debug('lobe-server:router:shareChat');

/**
 * The identity a shared-agent run executes under: the visitor drives it, but
 * every row, credential and balance it touches belongs to the creator.
 *
 * Note this is deliberately NOT a replacement for `AgentShareGate` — the gate
 * is the authorization SNAPSHOT (`generation` plus the full `shareConfig`) that
 * `assertRunnableForVisitor` re-checks right before the operation is created,
 * and it stays a method-level argument. The principal answers the narrower
 * question of *who* the run acts as and *whose* resources it may reach.
 */
const toVisitorPrincipal = (
  share: {
    agentId: string;
    ownerId: string;
    shareConfig: AgentShareConfig;
    shareId: string;
  },
  visitorUserId: string,
): ExecutionPrincipal =>
  createDelegatedPrincipal({
    actorUserId: visitorUserId,
    delegation: {
      agentId: share.agentId,
      grants: {
        allowReadMemory: share.shareConfig.allowReadMemory,
        enabledToolIds: share.shareConfig.enabledToolIds,
        filePermissionConfig: share.shareConfig.filePermissionConfig,
      },
      shareId: share.shareId,
    },
    resourceOwnerUserId: share.ownerId,
  });

/**
 * Visitor-facing execution chain for shared agents (Agent Share).
 *
 * All procedures authenticate the VISITOR (ctx.userId) but operate on
 * CREATOR-owned rows: topics/messages of a share conversation carry the
 * creator's userId (so runtime, billing, and tool paths behave exactly as a
 * creator-owned chat) plus `topics.senderId = visitor` AND `topics.shareId =`
 * the live `agentShares.id` for scoping. Every read/write here is therefore
 * manually authorized: resolve the share via `findByShareIdWithAccessCheck`,
 * then require `topic.senderId === visitor && topic.shareId === share.shareId`
 * (`findVisitorTopicOrThrow`). The `shareId` half matters because
 * `AgentShareModel.create()` mints a brand-new share UUID every disable →
 * re-enable cycle — without it, a returning visitor's `senderId` match alone
 * would resurface (and cap-count) conversations from a share instance the
 * owner already took down. See `topics.shareId`'s JSDoc
 * (`packages/database/src/schemas/topic.ts`).
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
 * the creator (creator-scoped TopicModel), so the senderId + agentId + shareId
 * match is the ONLY thing standing between a visitor and the creator's other
 * topics.
 *
 * `shareId` is required, not optional: without it, a returning visitor could
 * reach a topic created under a share instance the owner has since disabled
 * and replaced (`AgentShareModel.create()` mints a new `agentShares.id` every
 * disable → re-enable cycle) simply by remembering/bookmarking its topicId —
 * `senderId`/`agentId` alone still match. See `topics.shareId`'s JSDoc
 * (`packages/database/src/schemas/topic.ts`).
 */
const findVisitorTopicOrThrow = async (
  topicModel: TopicModel,
  params: { agentId: string; shareId: string; topicId: string; visitorUserId: string },
) => {
  const topic = await topicModel.findById(params.topicId);

  if (
    !topic ||
    topic.senderId !== params.visitorUserId ||
    topic.agentId !== params.agentId ||
    topic.shareId !== params.shareId
  ) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Topic not found' });
  }

  return topic;
};

/**
 * Convert an internal startup failure into a visitor-safe `TRPCError` —
 * reuses `sanitizeVisitorError` (`packages/database/src/models/message.ts`)
 * instead of a third ad-hoc redaction. `execAgent`/`interruptTask` can throw
 * BEFORE any Gateway streaming starts (e.g. the queue or runtime backend
 * returns a diagnostic), a failure surface neither existing visitor
 * projection covers — `toVisitorMessage` only runs over persisted rows and
 * `sanitizeErrorEventDataForVisitor` (`GatewayStreamNotifier.ts`) only runs
 * over live stream events — so without this, the raw `error.message` (which
 * can carry the creator's provider/infra diagnostic, since the run executes
 * under the CREATOR's identity) went straight to the visitor. Logs the raw
 * error server-side and returns only the classified `{ type }` (or `{
 * message }` for the narrow allowlisted codes) that `sanitizeVisitorError`
 * already deems visitor-safe.
 *
 * Also the sink for a RESOLVED (not thrown) `{ success: false, error }` from
 * `AiAgentService.execAgent` — a `createOperation` startup failure resolves
 * rather than rejects there (see `aiAgent/index.ts`'s `execAgent` catch
 * block), so the visitor-facing `execAgent` handler below re-throws that
 * case through this same function instead of letting the raw message escape
 * via a normal `return`.
 */
const toVisitorSafeStartupError = (context: string, error: unknown): TRPCError => {
  log('%s failed: %O', context, error);

  const raw = error as { message?: unknown; type?: unknown } | null | undefined;
  const safe = sanitizeVisitorError(
    raw && typeof raw === 'object'
      ? ({
          message: typeof raw.message === 'string' ? raw.message : undefined,
          type: raw.type,
        } as ChatMessageError)
      : undefined,
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
        /** See `SHARE_VISITOR_PROMPT_MAX_LENGTH`'s JSDoc for the size-bound rationale. */
        prompt: z.string().max(SHARE_VISITOR_PROMPT_MAX_LENGTH),
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

      // Fast, UX-only pre-check for both caps — mirrors the budget precheck
      // above, and for the same reason: reject an obviously-over-cap request
      // BEFORE paying for agent-config/tool resolution, instead of only at
      // dispatch. This is NOT the enforcement: it is a plain unlocked count,
      // so a burst of concurrent requests can all read the same pre-insert
      // count and all pass. The atomic, authoritative gate is
      // `reserveShareVisitorTopicOrThrow` / `reserveShareVisitorTurnOrThrow`
      // (`apps/server/src/services/aiAgent/shareVisitorAbuseGuards.ts`),
      // which locks and re-checks the same counters immediately around the
      // real topic/message INSERT inside `AiAgentService.execAgent` — see
      // those functions' JSDoc for the race this two-layer split closes.
      if (input.topicId) {
        await findVisitorTopicOrThrow(topicModel, {
          agentId: share.agentId,
          shareId: share.shareId,
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
          shareId: share.shareId,
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
        // See `AgentShareGate.generation`'s JSDoc — carried forward from this
        // SAME `findByShareIdWithAccessCheck` read as `shareConfig` above, so
        // `assertRunnableForVisitor` can detect a tightening that lands
        // between now and operation creation.
        generation: share.generation,
        shareConfig: share.shareConfig,
        // See `AgentShareGate.shareId`'s JSDoc — the share instance this run
        // is authorized against, for `topics.shareId` comparisons.
        shareId: share.shareId,
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

      const aiAgentService = new AiAgentService(
        ctx.serverDB,
        toVisitorPrincipal(share, ctx.userId),
        { marketAccessToken },
      );

      log('execAgent: share=%s visitor=%s topic=%s', input.shareId, ctx.userId, input.topicId);

      try {
        const result = await aiAgentService.execAgent({
          agentId: share.agentId,
          appContext: { topicId: input.topicId },
          clientIds: input.clientIds,
          clientIp: ctx.clientIp ?? undefined,
          // `interactiveStart: true` (the `aiAgent.execAgent` owner path's
          // default) makes `TopicModel.tryReserveTaskCallback` skip its
          // `runningOperation` liveness check entirely
          // (`ignoreRunningOperation`, see that method's JSDoc) — a policy
          // that is safe there ONLY because the owner's OWN client is the
          // thing serializing sends (its own queue/tray; see
          // `aiAgent.ts`'s `execAgent` comment), and a resend after Stop goes
          // through `replacesOperationId`, which `shareChat` never exposes to
          // visitors.
          //
          // An untrusted visitor has no such client-side gate: firing two
          // concurrent `execAgent` mutations for the SAME topic let both
          // requests pass `tryReserveTaskCallback` (each only contends on the
          // short-lived `taskCallbackReservation`, released right after the
          // first operation is CREATED, long before it finishes streaming),
          // so both created creator-credentialed operations. The second
          // operation's `runningOperation` marker write then overwrote the
          // first's, leaving the first operation unreachable by
          // `shareChat.interruptTask` (which matches on the topic's current
          // marker) and by `AiAgentService.interruptActiveShareRuns`'s
          // revocation sweep (which also reads only the current marker) —
          // an orphaned run that keeps using tools and the creator's share
          // budget until it finishes on its own (see `shareChat.ts:186`).
          //
          // Leaving this `false` (the background/task-callback default)
          // routes visitor sends through the SAME liveness-checked
          // reservation every non-interactive start already uses: a second
          // concurrent send for a topic with a live operation is rejected
          // (fails closed with a busy error after bounded retries) instead
          // of silently displacing the first.
          interactiveStart: false,
          prompt: input.prompt,
          shareGate,
          trigger: RequestTrigger.Chat,
          userAgent: ctx.userAgent ?? undefined,
        });

        // `AiAgentService.execAgent` RESOLVES (does not throw) when
        // `createOperation` itself fails to start (e.g. the queue/runtime
        // backend is unavailable) — see that method's catch block
        // (`aiAgent/index.ts`, the `success: false` return alongside
        // `error: errorMessage`). That `error` is the same raw
        // `error.message` the thrown path guards against (can carry the
        // CREATOR's provider/infra diagnostic), so it must go through the
        // exact same `toVisitorSafeStartupError` projection instead of
        // reaching the visitor verbatim via a normal `return`.
        //
        // Reject rather than sanitize-and-return: the Gateway client
        // (`gateway.ts`'s `executeGatewayAgent`) never checks
        // `result.success` — it unconditionally treats the resolved value as
        // a live operation and calls `connectToGateway` with its
        // `operationId`/`token`. A sanitized `success: false` object would
        // still be consumed as if the run started, opening a WebSocket for
        // an operation that never began (empty token) instead of surfacing
        // the failure through the same rejection path `sendMessage` already
        // handles for every other startup error on this endpoint.
        if (!result.success) {
          throw toVisitorSafeStartupError('execAgent', { message: result.error });
        }

        return result;
      } catch (error: any) {
        if (error instanceof TRPCError) throw error;

        throw toVisitorSafeStartupError('execAgent', error);
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
      shareId: share.shareId,
      topicId: input.topicId,
      visitorUserId: ctx.userId,
    });

    const messageModel = new MessageModel(ctx.serverDB, share.ownerId);
    const fileService = new FileService(ctx.serverDB, share.ownerId);

    // queryForVisitor strips the creator's `sender`/spend/model-snapshot
    // fields — share messages persist under the CREATOR's account (see the
    // module doc above), so the raw `query()` result would otherwise leak
    // the creator's account identity to the visitor.
    return messageModel.queryForVisitor(
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
      return topicModel.queryBySender({
        agentId: share.agentId,
        senderId: ctx.userId,
        shareId: share.shareId,
      });
    }),

  /**
   * Interrupt a running share operation — the visitor counterpart of
   * `aiAgent.interruptTask`. Visitors have no owner-scoped access to
   * `aiAgent.interruptTask` (its models are scoped to the caller, and share
   * runs execute under the CREATOR's identity), so without this endpoint a
   * visitor's Stop / tab-close cannot reach the server: the run keeps
   * streaming and consuming the creator's share budget until it finishes on
   * its own (see gateway.ts `onOperationCancel` for the client-side symptom).
   *
   * Authorization is intentionally stricter than `execAgent`/`getMessages`:
   * it is not enough that the topic belongs to this visitor — the
   * `operationId` must also match the operation CURRENTLY recorded as
   * running on that topic. Without that check a visitor could pass an
   * arbitrary operationId (topics/operations are creator-owned rows) and
   * interrupt an unrelated run on the creator's account.
   */
  interruptTask: shareChatProcedure
    .input(ShareTopicScopeSchema.extend({ operationId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const share = await AgentShareModel.findByShareIdWithAccessCheck(
        ctx.serverDB,
        input.shareId,
        ctx.userId,
      );

      const topicModel = new TopicModel(ctx.serverDB, share.ownerId);
      const topic = await findVisitorTopicOrThrow(topicModel, {
        agentId: share.agentId,
        shareId: share.shareId,
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
      const aiAgentService = new AiAgentService(
        ctx.serverDB,
        toVisitorPrincipal(share, ctx.userId),
      );

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

        throw toVisitorSafeStartupError('interruptTask', error);
      }
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
        shareId: share.shareId,
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
