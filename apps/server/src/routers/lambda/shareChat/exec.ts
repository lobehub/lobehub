import {
  AGENT_SHARE_DEFAULT_MAX_TOPICS_PER_VISITOR,
  AGENT_SHARE_DEFAULT_MAX_TURNS_PER_TOPIC,
  SHARE_VISITOR_MAX_FILES_PER_TURN,
  SHARE_VISITOR_PROMPT_MAX_LENGTH,
} from '@lobechat/const';
import {
  agentShareFileAccessScope,
  ChatErrorType,
  RequestTrigger,
  UserInterventionConfigSchema,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { z } from 'zod';

import { checkAgentShareSpendAllowance } from '@/business/server/agent-share/spendGate';
import { FileModel } from '@/database/models/file';
import { HumanApprovalAlreadyResolvedError } from '@/database/models/message';
import type { LobeChatDatabase } from '@/database/type';

import { execAgentClientIdsSchema } from '../_helpers/execAgentClientIds';
import {
  bridgeLegacyResumeToSourceIntervention,
  ResumeApprovalDecisionSchema,
  ResumeToolResultSchema,
  validateResumePayload,
} from '../aiAgent';
import {
  findVisitorTopicOrThrow,
  resolveLinkShareOrThrow,
  toVisitorSafeStartupError,
} from './guards';
import { shareChatProcedure } from './procedures';
import { createShareRunScope } from './runScope';

const log = debug('lobe-server:router:shareChat');

/**
 * Every attachment id a visitor pins to a turn must be a file THIS visitor
 * uploaded through THIS share (`shareChat.createFile`). Visitor uploads live
 * under the creator's account, so a creator-scoped lookup would happily
 * resolve any of the creator's files — the `agentShare` provenance on the row
 * is the only thing that stops a visitor from naming an arbitrary id and
 * having the creator's own document injected into the run. `NOT_FOUND` on
 * purpose — same fail-closed shape as the topic guard, revealing nothing
 * about whether the id exists for someone else.
 */
const assertShareVisitorFiles = async (
  db: LobeChatDatabase,
  share: { ownerId: string; shareId: string; workspaceId: string | null },
  visitorUserId: string,
  fileIds: string[] | undefined,
) => {
  if (!fileIds?.length) return;

  const uniqueIds = Array.from(new Set(fileIds));
  const rows = await new FileModel(db, share.ownerId, share.workspaceId ?? undefined).findByIds(
    uniqueIds,
    agentShareFileAccessScope({ shareId: share.shareId, visitorUserId }),
  );
  if (rows.length !== uniqueIds.length) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found' });
  }
};

export const execProcedures = {
  /**
   * Execute a shared agent as a visitor — the gateway-transport mirror of
   * `aiAgent.execAgent`, restricted to the share surface: fixed agent, no
   * device/local targets, share-config tool allowlist, per-visitor caps.
   */
  execAgent: shareChatProcedure
    .input(
      z
        .object({
          /** Client-minted row ids, honoured verbatim (see `execAgentClientIdsSchema`). */
          clientIds: execAgentClientIdsSchema,
          /**
           * Ids of files the VISITOR uploaded through `shareChat.createFile`.
           * Re-checked below against the file rows' share provenance — see
           * `assertShareVisitorFiles`.
           */
          fileIds: z
            .array(z.string().min(1).max(64))
            .max(SHARE_VISITOR_MAX_FILES_PER_TURN)
            .optional(),
          /**
           * The pending tool message a resume targets. Set only together with one
           * of the `resume*` payloads — a visitor never regenerates or continues
           * from an arbitrary message.
           */
          parentMessageId: z.string().optional(),
          /** See `SHARE_VISITOR_PROMPT_MAX_LENGTH`'s JSDoc for the size-bound rationale. */
          prompt: z.string().max(SHARE_VISITOR_PROMPT_MAX_LENGTH),
          /**
           * Legacy (message-row) resume of the visitor's own parked run — the
           * fallback when the deployment has no durable intervention store; see
           * `resolveInterventionBySource` for the primary path.
           */
          resumeApproval: ResumeApprovalDecisionSchema.optional(),
          resumeApprovals: z.array(ResumeApprovalDecisionSchema).min(1).optional(),
          resumeToolResult: ResumeToolResultSchema.optional(),
          shareId: z.string(),
          /** Queued behind a running turn; see `aiAgent.execAgent`'s `steer`. */
          steer: z.boolean().optional(),
          /** Absent → the run creates a new visitor topic (counted against the topic cap). */
          topicId: z.string().nullish(),
          /**
           * The VISITOR's own approval mode / allow list. A share run is approved
           * by the visitor, so it honors their preference exactly like the owner's
           * own chat honors the owner's; absent → `manual` (see
           * `AiAgentService.execAgent`).
           */
          userInterventionConfig: UserInterventionConfigSchema.optional(),
        })
        .superRefine((data, refinementCtx) => {
          validateResumePayload(data, refinementCtx);
          const isResume = Boolean(
            data.resumeApproval || data.resumeApprovals || data.resumeToolResult,
          );
          if (data.parentMessageId && !isResume) {
            refinementCtx.addIssue({
              code: 'custom',
              message: 'parentMessageId is only accepted with an intervention resume',
              path: ['parentMessageId'],
            });
          }
          if (isResume && !data.topicId) {
            refinementCtx.addIssue({
              code: 'custom',
              message: 'topicId is required for an intervention resume',
              path: ['topicId'],
            });
          }
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
        workspaceId: share.workspaceId ?? undefined,
      });
      if (!spendGate.allowed) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: ChatErrorType.ShareSpendLimitExceeded,
        });
      }

      const isResume = Boolean(
        input.resumeApproval || input.resumeApprovals || input.resumeToolResult,
      );
      if (isResume && input.fileIds?.length) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'An intervention resume cannot attach files',
        });
      }

      // Verify every attachment is this visitor's own share upload before it
      // is handed to a run that executes (and reads files) as the creator.
      // Also ahead of any row creation, like the spend gate — a foreign id
      // must not leave a topic behind.
      await assertShareVisitorFiles(ctx.serverDB, share, ctx.userId, input.fileIds);

      // Runtime-normalized (findByShareIdWithAccessCheck fills defaults), but
      // the config TYPE keeps every field optional — re-apply the same default
      // constants rather than asserting non-null.
      const maxTopicsPerVisitor =
        share.shareConfig.maxTopicsPerVisitor ?? AGENT_SHARE_DEFAULT_MAX_TOPICS_PER_VISITOR;
      const maxTurnsPerTopic =
        share.shareConfig.maxTurnsPerTopic ?? AGENT_SHARE_DEFAULT_MAX_TURNS_PER_TOPIC;
      const { aiAgentService, dispatchContext, messageModel, shareGate, topicModel } =
        await createShareRunScope(ctx.serverDB, share, ctx.userId);

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

        // A resume continues the turn the visitor already spent — it adds no
        // user message (`reserveShareVisitorTurn` skips it too), so a visitor
        // on their last allowed turn can still answer that turn's approval.
        const turnCount = isResume
          ? 0
          : await messageModel.countByTopic({
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

      log('execAgent: share=%s visitor=%s topic=%s', input.shareId, ctx.userId, input.topicId);

      try {
        if (isResume) {
          // Claim the durable generic intervention first when the deployment
          // provides a durable store, scoped to this visitor's own share run;
          // falls through to the legacy message-row resume when no durable row
          // exists.
          const bridged = await bridgeLegacyResumeToSourceIntervention(
            {
              messageModel,
              parentMessageId: input.parentMessageId,
              resumeApproval: input.resumeApproval,
              resumeApprovals: input.resumeApprovals,
              resumeToolResult: input.resumeToolResult,
              shareVisitor: {
                agentId: share.agentId,
                ownerUserId: share.ownerId,
                topicId: input.topicId!,
              },
            },
            dispatchContext,
          );
          if (bridged) return bridged;
        }

        const result = await aiAgentService.execAgent({
          agentId: share.agentId,
          appContext: { topicId: input.topicId },
          clientIds: input.clientIds,
          clientIp: ctx.clientIp ?? undefined,
          // Share uploads are creator-owned rows (see `createFile` below), so
          // the creator-scoped runtime resolves them like any owner attachment.
          fileIds: input.fileIds,
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
          //
          // A resume is the exception: the topic is still held by the parked
          // (`waiting_for_human`) operation it answers, so the liveness check
          // would always reject it as busy. Its concurrency guard is the
          // exactly-once approval claim instead (`claimApprovalResume` locks the
          // pending tool rows via `resolveHumanApproval`), so a duplicate resume
          // fails there rather than starting a second continuation.
          interactiveStart: isResume,
          parentMessageId: input.parentMessageId,
          prompt: input.prompt,
          resume: isResume,
          resumeApproval: input.resumeApproval,
          resumeApprovals: input.resumeApprovals,
          resumeToolResult: input.resumeToolResult,
          shareGate,
          steer: input.steer,
          // Not `RequestTrigger.Chat`: a share run is billed to the CREATOR,
          // so its spend rows must be separable from the creator's own chat
          // spend (they land on the same account). The trigger rides
          // `state.origin.trigger` all the way into the spend-log metadata.
          trigger: RequestTrigger.AgentShare,
          userAgent: ctx.userAgent ?? undefined,
          userInterventionConfig: input.userInterventionConfig,
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
        if (error instanceof HumanApprovalAlreadyResolvedError) {
          throw new TRPCError({
            cause: error,
            code: 'CONFLICT',
            message: 'This approval has already been resolved.',
          });
        }

        throw toVisitorSafeStartupError('execAgent', error, {
          showErrorDetails: share.shareConfig.showErrorDetails,
        });
      }
    }),
};
