import { randomUUID } from 'node:crypto';

import { type AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { LocalExecutionHeterogeneousAgentTypeSchema } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  getHeteroInterventionReview,
  onHeteroInterventionResolutionPublished,
  resolveHeteroIntervention,
  rollbackHeteroInterventionResolution,
} from '@/business/server/agent-run/heteroInterventionReview';
import { agentOperations } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { signHeteroOperationJWT } from '@/libs/trpc/utils/internalJwt';
import { createStreamEventManager } from '@/server/modules/AgentRuntime/factory';
import { mapAgentInterventionTRPCError } from '@/server/routers/lambda/_helpers/agentInterventionError';
import { HeterogeneousAgentService } from '@/server/services/heterogeneousAgent';
import {
  HeteroOperationPrincipalError,
  resolveActiveHeteroOperationPrincipal,
} from '@/server/services/heterogeneousAgent/operationPrincipal';

import { assertCanUseOperationAgent, resolveHeteroTopicWorkspace } from './guards';
import { aiAgentBaseProcedure, aiAgentWriteProcedure, heteroAgentProcedure } from './procedures';

const log = debug('lobe-server:ai-agent-router');

/**
 * Wire shape of an `AgentStreamEvent` produced by `lh hetero exec`. Mirrors
 * `AgentStreamEvent` in `@lobechat/agent-gateway-client` (kept here as a Zod
 * schema for tRPC input validation; tRPC's type inference takes care of the
 * client-side typing). Republished verbatim through `StreamEventManager` so
 * gateway WS subscribers see the same shape regardless of producer.
 */
const AgentStreamEventSchema = z.object({
  data: z.any(),
  operationId: z.string(),
  stepIndex: z.number().int().nonnegative(),
  timestamp: z.number().int().nonnegative(),
  type: z.enum([
    'agent_runtime_init',
    'agent_runtime_end',
    'stream_start',
    'stream_chunk',
    'stream_end',
    'visible_output_end',
    'stream_retry',
    'tool_start',
    'tool_end',
    'tool_execute',
    'llm_execute',
    'llm_cancel',
    'tool_result',
    'agent_intervention_request',
    'agent_intervention_response',
    'step_start',
    'step_complete',
    'notify_update',
    'error',
  ]),
});

/**
 * Schema for `aiAgent.heteroIngest` — accepts a batch of producer-side
 * `AgentStreamEvent`s from `lh hetero exec`. `topicId` is required (operationId
 * → topic reverse-lookup is unreliable per design decision).
 */
const HeteroIngestSchema = z.object({
  agentType: LocalExecutionHeterogeneousAgentTypeSchema,
  /** Initial assistant placeholder message id forwarded from the sandbox env var.
   * When present, `loadOrCreateState` uses it directly and skips the DB read of
   * topic.metadata.runningOperation, eliminating the replica-lag race condition. */
  assistantMessageId: z.string().min(1).optional(),
  events: z.array(AgentStreamEventSchema).min(1),
  operationId: z.string().min(1),
  topicId: z.string().min(1),
});

/**
 * Schema for `aiAgent.heteroFinish` — terminal call, mirrors the CLI process
 * exit. `result` is the high-level outcome; `error` carries CLI-classified
 * details when `result === 'error'`. `sessionId` is the native CLI session
 * (CC's per-cwd id), kept here so the server can resume next time.
 */
const HeteroFinishSchema = z.object({
  agentType: LocalExecutionHeterogeneousAgentTypeSchema,
  /** Initial assistant placeholder forwarded by the producer. Unlike the live
   * ingest path, finish may arrive after gateway session completion has already
   * cleared topic.metadata.runningOperation, so this is the durable fallback
   * anchor for projecting a terminal error onto the assistant turn. */
  assistantMessageId: z.string().min(1).optional(),
  error: z
    .object({
      /**
       * Structured status-guide error for process-level failures (CLI not
       * installed, auth required) — the CLI's `classifyHeteroProcessFailure`
       * output. Persisted verbatim as the `ChatMessageError.body` so the
       * client renders the dedicated guide.
       */
      body: z.record(z.string(), z.unknown()).optional(),
      message: z.string(),
      type: z.string(),
    })
    .optional(),
  operationId: z.string().min(1),
  result: z.enum(['success', 'error', 'cancelled']),
  sessionId: z.string().optional(),
  topicId: z.string().min(1),
});

/**
 * Schema for `aiAgent.waitInterventionResponse` — the exec-side long-poll. The
 * `lh hetero exec` producer calls this in a loop while an `AskUserBridge`
 * pending is in flight, draining `agent_intervention_response` events off the
 * op's Redis stream (which the sandbox can't read directly). `lastEventId`
 * threads the cursor forward across polls; `'$'` on the first call means
 * "only events published from now on".
 */
const WaitInterventionResponseSchema = z.object({
  blockMs: z.number().int().positive().max(30_000).default(25_000),
  lastEventId: z.string().default('$'),
  operationId: z.string().min(1),
});

/**
 * Schema for `aiAgent.submitHeteroIntervention` — the browser leg of remote
 * Human-in-the-loop. The user's answer to an `agent_intervention_request` is
 * published back onto the op's Redis stream as an `agent_intervention_response`,
 * where both the renderer (card → resolved) and the exec long-poll converge on
 * it by `toolCallId`. Mutually exclusive: `result` on submit, `cancelled` on
 * skip/cancel.
 */
const SubmitHeteroInterventionSchema = z.object({
  cancelReason: z.enum(['timeout', 'user_cancelled', 'session_ended']).optional(),
  cancelled: z.boolean().optional(),
  operationId: z.string().min(1),
  /** Optional only for backward compatibility with pre-contract Web clients. */
  resolutionRequestId: z.string().uuid().optional(),
  result: z.unknown().optional(),
  /** Producer step index; harmless placeholder — correlation is by toolCallId. */
  stepIndex: z.number().int().nonnegative().default(0),
  toolCallId: z.string().min(1),
});

const HeteroInterventionReviewTokenSchema = z.object({
  /** 32 random bytes encoded as base64url without padding. */
  reviewToken: z.string().regex(/^[\w-]{43}$/),
});

const ResolveHeteroInterventionReviewSchema = z.object({
  action: z.enum(['submit', 'skip']),
  resolutionRequestId: z.string().uuid(),
  result: z.unknown().optional(),
  reviewToken: z.string().regex(/^[\w-]{43}$/),
});

const publishClaimedHeteroIntervention = async (params: {
  claim: Extract<
    Awaited<ReturnType<typeof resolveHeteroIntervention>>,
    { handled: true; state: 'claimed' }
  >;
  userId: string;
  workspaceId?: string | null;
}) => {
  const { claim, userId, workspaceId } = params;
  const resolvedWorkspaceId = claim.workspaceId ?? workspaceId ?? undefined;
  const streamEventManager = createStreamEventManager();

  try {
    await streamEventManager.publishStreamEvent(claim.operationId, {
      data: {
        ...claim.response,
        producerAck: false,
        resolutionRequestId: claim.resolutionRequestId,
      },
      stepIndex: claim.stepIndex ?? 0,
      type: 'agent_intervention_response',
    });
  } catch (error) {
    await rollbackHeteroInterventionResolution({
      claimId: claim.claimId,
      operationId: claim.operationId,
      resolutionRequestId: claim.resolutionRequestId,
      toolCallId: claim.response.toolCallId,
      userId,
      workspaceId: resolvedWorkspaceId,
    }).catch((rollbackError) => {
      log(
        'conditional intervention rollback failed claim=%s op=%s: %O',
        claim.claimId,
        claim.operationId,
        rollbackError,
      );
    });
    throw error;
  }

  // Notification surfaces may switch to `resolving` only after XADD has
  // succeeded. This best-effort side effect must not roll back a response the
  // producer can already consume from the stream.
  await onHeteroInterventionResolutionPublished({
    claimId: claim.claimId,
    operationId: claim.operationId,
    resolutionRequestId: claim.resolutionRequestId,
    status: 'resolving',
    toolCallId: claim.response.toolCallId,
    userId,
    workspaceId: resolvedWorkspaceId,
  }).catch((notificationError) => {
    log(
      'intervention published hook failed claim=%s op=%s: %O',
      claim.claimId,
      claim.operationId,
      notificationError,
    );
  });

  return {
    // XADD only acknowledges transport acceptance. The producer's echoed
    // response is the authoritative terminal transition persisted by the
    // intervention reducer; until then the durable row remains resolving.
    status: 'resolving' as const,
    success: true as const,
  };
};

const authorizeOperationCallback = async (
  ctx: {
    heteroAuthKind: string;
    heteroOperation?: NonNullable<
      Parameters<typeof resolveActiveHeteroOperationPrincipal>[0]['claims']
    > | null;
    serverDB: LobeChatDatabase;
  },
  operationId: string,
  capability: 'hetero:finish' | 'hetero:ingest' | 'hetero:intervention:read',
  options: { allowTerminalOperation?: boolean } = {},
) => {
  if (ctx.heteroAuthKind !== 'operation') return;
  if (!ctx.heteroOperation) throw new TRPCError({ code: 'UNAUTHORIZED' });
  try {
    await resolveActiveHeteroOperationPrincipal({
      allowTerminalOperation: options.allowTerminalOperation,
      capability,
      claims: ctx.heteroOperation,
      db: ctx.serverDB,
      operationId,
    });
  } catch (error) {
    if (!(error instanceof HeteroOperationPrincipalError)) throw error;
    throw new TRPCError({
      cause: error,
      code: error.status === 401 ? 'UNAUTHORIZED' : error.status === 409 ? 'CONFLICT' : 'FORBIDDEN',
      message: error.message,
    });
  }
};

export const heteroProcedures = {
  /**
   * Ingest a batch of `AgentStreamEvent`s from a `lh hetero exec` producer
   * (CLI standalone, sandboxed CC, etc.) and republish them through the
   * existing stream fanout so renderer-side gateway WS subscribers see them
   * unchanged. Phase 2a: pub/sub only — no DB persistence (phase 2b adds it).
   */
  heteroIngest: heteroAgentProcedure.input(HeteroIngestSchema).mutation(async ({ input, ctx }) => {
    const { agentType, assistantMessageId, events, operationId, topicId } = input;

    // "The operation already ended" is one of the two refusals this procedure
    // exists to report, so it has to survive the door check — rejecting it here
    // would make the producer retry a permanent refusal through its whole
    // budget and leave no record that its output was dropped. The batch still
    // cannot be persisted: the service refuses it on the very same status.
    await authorizeOperationCallback(ctx, operationId, 'hetero:ingest', {
      allowTerminalOperation: true,
    });

    log(
      'heteroIngest: topic=%s op=%s type=%s count=%d',
      topicId,
      operationId,
      agentType,
      events.length,
    );

    try {
      const wsId = await resolveHeteroTopicWorkspace({
        db: ctx.serverDB,
        requestedWorkspaceId: ctx.workspaceId,
        topicId,
        userId: ctx.userId,
      });
      const heteroService = new HeterogeneousAgentService(ctx.serverDB, ctx.userId, {
        workspaceId: wsId,
      });

      // Zod's z.any() infers `data?: any`, but the wire shape always includes
      // a `data` field (may be null). Cast at the boundary instead of widening
      // the shared `AgentStreamEvent` type or the service signature.
      const outcome = await heteroService.heteroIngest({
        agentType,
        assistantMessageId,
        events: events as AgentStreamEvent[],
        operationId,
        topicId,
      });

      // A refused batch is reported in the ack, not as a transport error: it is
      // permanent (every later batch is refused too), so a producer must stop
      // and fail the run rather than burn its retry budget on it. Returned
      // alongside the original `ack` so producers that predate this field keep
      // working — the row marker `heteroIngest` stamps is what covers them.
      return { ack: true as const, ...outcome };
    } catch (error: any) {
      // Preserve deliberate auth errors (e.g. the ownership FORBIDDEN) instead
      // of masking them as a generic 500.
      if (error instanceof TRPCError) throw error;
      log('heteroIngest failed: %s', error?.message);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: error?.message || 'Failed to ingest heterogeneous agent events',
      });
    }
  }),
  /**
   * Re-mint the operation token a long `lh hetero exec` run authenticates with.
   *
   * The token is signed for four hours, and a Goal Task can run far longer. Past
   * the expiry every heteroIngest is rejected, the run's heartbeats stop renewing
   * its lease, and the operation is reclaimed as abandoned while the agent is still
   * working. The producer calls this before expiry. The replacement carries the
   * same claims, and is issued only while the operation is still running under a
   * principal that is still authorized — so renewal never outlives revocation.
   */
  refreshHeteroOperationToken: heteroAgentProcedure
    .input(z.object({ operationId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      // A user session has its own refresh flow, and a legacy token carries no
      // operation claims to copy, so only the narrow operation token renews here.
      if (ctx.heteroAuthKind !== 'operation' || !ctx.heteroOperation) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only an operation token can be renewed',
        });
      }
      await authorizeOperationCallback(ctx, input.operationId, 'hetero:ingest');

      const claims = ctx.heteroOperation;
      const jwt = await signHeteroOperationJWT({
        capabilities: claims.capabilities,
        model: claims.model,
        operationId: claims.operation_id,
        providerId: claims.provider_id,
        userId: claims.sub,
        workspaceId: claims.workspace_id,
      });

      return { jwt };
    }),
  /**
   * Terminal handshake from a `lh hetero exec` producer: signals process exit
   * and carries the run's high-level outcome. Always emits a final
   * `agent_runtime_end` so renderer subscribers can shut down even when the
   * CLI's own end-event was lost mid-flight.
   */
  heteroFinish: heteroAgentProcedure.input(HeteroFinishSchema).mutation(async ({ input, ctx }) => {
    const { agentType, assistantMessageId, error, operationId, result, sessionId, topicId } = input;

    // A terminal row is the normal state for a finish that lost a race (gateway
    // completion, a settle from another tab). The service already has the stale
    // branches for it; turning it away here would drop the run's outcome instead
    // — no error bubble, no lifecycle hooks, no bot callback.
    await authorizeOperationCallback(ctx, operationId, 'hetero:finish', {
      allowTerminalOperation: true,
    });

    log('heteroFinish: topic=%s op=%s type=%s result=%s', topicId, operationId, agentType, result);

    try {
      const wsId = await resolveHeteroTopicWorkspace({
        db: ctx.serverDB,
        requestedWorkspaceId: ctx.workspaceId,
        topicId,
        userId: ctx.userId,
      });
      const heteroService = new HeterogeneousAgentService(ctx.serverDB, ctx.userId, {
        workspaceId: wsId,
      });

      // heteroFinish now owns the full terminal transition: it fires the run's
      // onComplete/onError hooks through the shared hookDispatcher, which drives
      // the task lifecycle (onTopicComplete) and any IM bot completion callback —
      // the same mechanism the normal LLM runtime uses. No bespoke lifecycle call
      // here anymore; this is just the server-to-server ack endpoint.
      await heteroService.heteroFinish({
        agentType,
        assistantMessageId,
        error,
        operationId,
        result,
        sessionId,
        topicId,
      });

      return { ack: true as const };
    } catch (err: any) {
      // Preserve deliberate auth errors (e.g. the ownership FORBIDDEN) instead
      // of masking them as a generic 500.
      if (err instanceof TRPCError) throw err;
      log('heteroFinish failed: %s', err?.message);
      throw new TRPCError({
        cause: err,
        code: 'INTERNAL_SERVER_ERROR',
        message: err?.message || 'Failed to finalize heterogeneous agent run',
      });
    }
  }),
  /**
   * Exec-side long-poll for remote Human-in-the-loop (op-JWT auth, same as
   * `heteroIngest`). The `lh hetero exec` producer — which holds only an
   * op-scoped JWT + tRPC and never the server's Redis — pulls
   * `agent_intervention_response` events off the op's Redis stream through this
   * server-mediated read, then resolves its in-process `AskUserBridge`. One
   * bounded `XREAD BLOCK` per call; the producer loops while a pending is in
   * flight, threading `lastEventId` forward so nothing is missed between polls.
   */
  waitInterventionResponse: heteroAgentProcedure
    .input(WaitInterventionResponseSchema)
    .query(async ({ input, ctx }) => {
      const { operationId, lastEventId, blockMs } = input;

      await authorizeOperationCallback(ctx, operationId, 'hetero:intervention:read');

      // Ownership guard, mirroring heteroIngest / heteroFinish. The op stream is
      // read by `operationId` alone, so an owner-token caller (a logged-in
      // desktop reusing its own OIDC session) must prove it owns THIS operation
      // — otherwise any signed-in user could long-poll another run's
      // `agent_intervention_response` payloads by id. Bind the guard to the
      // operation row directly (tighter than the topic-level guard the write
      // paths use, since the read has no topicId to key on). Strict operation-token
      // callers already passed the durable principal check above; user tokens and
      // pre-deploy operation tokens use the legacy ownership lookup.
      if (ctx.heteroAuthKind !== 'operation') {
        const [operationRow] = await ctx.serverDB
          .select({ userId: agentOperations.userId })
          .from(agentOperations)
          .where(eq(agentOperations.id, operationId))
          .limit(1);

        if (operationRow?.userId !== ctx.userId) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Operation not found or not owned by the caller',
          });
        }
      }

      const streamEventManager = createStreamEventManager();
      const { events, lastEventId: nextEventId } = await streamEventManager.readEventsOnce(
        operationId,
        lastEventId,
        blockMs,
      );

      // Only intervention responses matter to the producer; everything else on
      // the stream is already going out via its own outbound ingest path.
      return {
        events: events.filter((e) => e.type === 'agent_intervention_response'),
        lastEventId: nextEventId,
      };
    }),
  /**
   * Authenticated cold-start review lookup. The opaque token is the only
   * client-supplied locator; Cloud resolves operation/tool ownership inside
   * the business slot. Keep this read-only operation on the mutation transport
   * so the review token is carried in the POST body instead of a query URL that
   * infrastructure access logs commonly retain. OSS reports `unavailable`
   * without exposing internals.
   */
  getHeteroInterventionReview: aiAgentBaseProcedure
    .input(HeteroInterventionReviewTokenSchema)
    .mutation(({ input, ctx }) =>
      getHeteroInterventionReview({
        reviewToken: input.reviewToken,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      }),
    ),
  /** Token-only atomic resolution path used by Mobile review/deep links. */
  resolveHeteroIntervention: aiAgentWriteProcedure
    .input(ResolveHeteroInterventionReviewSchema)
    .mutation(async ({ input, ctx }) => {
      const resolution = await resolveHeteroIntervention({
        action: input.action,
        cancelReason: input.action === 'skip' ? 'user_cancelled' : undefined,
        result: input.action === 'submit' ? input.result : undefined,
        resolutionRequestId: input.resolutionRequestId,
        target: { reviewToken: input.reviewToken },
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      }).catch((error: unknown) => {
        throw mapAgentInterventionTRPCError(error);
      });

      if (!resolution.handled) return { status: 'unavailable' as const, success: false as const };
      if (resolution.state === 'already_resolved') {
        return { status: resolution.status, success: true as const };
      }

      return publishClaimedHeteroIntervention({
        claim: resolution,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
    }),
  /**
   * Browser leg of remote Human-in-the-loop (user auth). Publishes the user's
   * answer to an `agent_intervention_request` back onto the op's Redis stream
   * as an `agent_intervention_response`. Two consumers converge on it by
   * `toolCallId`: the renderer (card → resolved) and the exec long-poll
   * (`waitInterventionResponse` → `bridge.resolve`). Symmetric with the
   * desktop path, which resolves the bridge over Electron IPC instead.
   */
  submitHeteroIntervention: aiAgentWriteProcedure
    .input(SubmitHeteroInterventionSchema)
    .mutation(async ({ input, ctx }) => {
      const {
        operationId,
        toolCallId,
        stepIndex,
        result,
        cancelled,
        resolutionRequestId = randomUUID(),
      } = input;

      log(
        'submitHeteroIntervention: op=%s toolCallId=%s cancelled=%s',
        operationId,
        toolCallId,
        cancelled ?? false,
      );

      await assertCanUseOperationAgent({
        db: ctx.serverDB,
        operationId,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });

      // Cloud overrides this as an atomic first-winner claim shared by Web and
      // Mobile. OSS returns `handled:false` and preserves the legacy stream
      // publish below. A claimed response is authoritative: client-supplied
      // operation/tool fields cannot override what Cloud resolved durably.
      const businessResolution = await resolveHeteroIntervention({
        action: cancelled ? 'skip' : 'submit',
        cancelReason: cancelled ? 'user_cancelled' : undefined,
        result: cancelled ? undefined : result,
        resolutionRequestId,
        target: { operationId, toolCallId },
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });
      if (businessResolution.handled) {
        if (businessResolution.state === 'already_resolved') {
          return { status: businessResolution.status, success: true as const };
        }
        return publishClaimedHeteroIntervention({
          claim: businessResolution,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
      }

      const streamEventManager = createStreamEventManager();
      await streamEventManager.publishStreamEvent(operationId, {
        data: {
          // Client-driven cancellation cannot impersonate producer timeout or
          // session teardown; those terminal reasons originate from bridge ACKs.
          cancelReason: cancelled ? 'user_cancelled' : undefined,
          cancelled,
          producerAck: false,
          result: cancelled ? undefined : result,
          resolutionRequestId,
          toolCallId,
        },
        stepIndex,
        type: 'agent_intervention_response',
      });

      return { status: 'resolving' as const, success: true as const };
    }),
};
