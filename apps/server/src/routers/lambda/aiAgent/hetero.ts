import { type AgentStreamEvent } from '@lobechat/agent-gateway-client';
import {
  CODEX_COLLABORATION_MODES,
  HETERO_PERMISSION_MODES,
  LocalExecutionHeterogeneousAgentTypeSchema,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  getHeteroInterventionReview,
  resolveHeteroIntervention,
} from '@/business/server/agent-run/heteroInterventionReview';
import { agentOperations } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { router } from '@/libs/trpc/lambda';
import { signHeteroOperationJWT } from '@/libs/trpc/utils/internalJwt';
import { createStreamEventManager } from '@/server/modules/AgentRuntime/factory';
import { mapAgentInterventionTRPCError } from '@/server/routers/lambda/_helpers/agentInterventionError';
import { AiAgentService } from '@/server/services/aiAgent';
import { readFollowUpMode } from '@/server/services/aiAgent/steerQueue/followUpMode';
import {
  renewHeteroSteers,
  returnHeteroSteer,
  takeHeteroSteer,
} from '@/server/services/aiAgent/steerQueue/hetero';
import { setHeteroCollaborationMode } from '@/server/services/aiAgent/steerQueue/heteroCollaborationMode';
import {
  type HeteroControlMessage,
  reportHeteroControlResult,
  takeHeteroControl,
} from '@/server/services/aiAgent/steerQueue/heteroControl';
import { setHeteroPermissionMode } from '@/server/services/aiAgent/steerQueue/heteroPermissionMode';
import { stopHeteroBackgroundTask } from '@/server/services/aiAgent/steerQueue/heteroStopTask';
import { HeterogeneousAgentService } from '@/server/services/heterogeneousAgent';
import {
  HeteroOperationPrincipalError,
  resolveActiveHeteroOperationPrincipal,
} from '@/server/services/heterogeneousAgent/operationPrincipal';
import { resolveHeteroRunShareVisitor } from '@/server/services/heterogeneousAgent/shareVisitor';

import { assertCanUseOperationAgent, resolveHeteroTopicWorkspace } from './guards';
import {
  publishClaimedHeteroIntervention,
  submitHeteroInterventionAs,
  SubmitHeteroInterventionSchema,
} from './heteroInterventionSubmit';
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
    'background_task',
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
 * Schema for `aiAgent.waitHeteroSteer` — the exec-side long-poll for follow-ups
 * the user queued behind a live heterogeneous run (Claude Code), delivered into
 * its session instead of waiting for the run to end.
 */
const WaitHeteroSteerSchema = z.object({
  /**
   * The producer handles control messages (`control` on the answer) and
   * reports each one through `reportHeteroControlResult`. Older producers omit
   * it: they never get one, so a control message for their run expires.
   */
  acceptsControl: z.boolean().optional(),
  /** The producer can deliver uploaded images without falling back to text on failure. */
  acceptsImageAttachments: z.boolean().optional(),
  /**
   * The producer types image blocks into the session (`imageList` on the
   * message). Older producers omit it and only ever get text-only follow-ups.
   */
  acceptsImages: z.boolean().optional(),
  blockMs: z.number().int().positive().max(25_000).default(20_000),
  /**
   * The session waits for the user (a question or an approval): hand it no
   * follow-up now, only control messages. Older producers omit it.
   */
  holdSteer: z.boolean().optional(),
  operationId: z.string().min(1),
});

/** Schema for `aiAgent.stopHeteroBackgroundTask` — stop one Claude Code background task. */
const StopHeteroBackgroundTaskSchema = z.object({
  operationId: z.string().min(1),
  taskId: z.string().min(1).max(256),
});

/** Schema for `aiAgent.setHeteroPermissionMode` — switch a running Claude Code's mode. */
const SetHeteroPermissionModeSchema = z.object({
  mode: z.enum(HETERO_PERMISSION_MODES),
  operationId: z.string().min(1),
});

/** Schema for `aiAgent.setHeteroCollaborationMode` — the Codex Plan switch, mid-run. */
const SetHeteroCollaborationModeSchema = z.object({
  mode: z.enum(CODEX_COLLABORATION_MODES),
  operationId: z.string().min(1),
});

/** Schema for `aiAgent.returnHeteroSteer` — the session could not take the message. */
const ReturnHeteroSteerSchema = z.object({
  messageId: z.string().min(1),
  operationId: z.string().min(1),
});

/**
 * Schema for `aiAgent.reportHeteroControlResult` — how the run handled a
 * control message `waitHeteroSteer` handed out: done, no handler for the
 * command, or the handler failed.
 */
const ReportHeteroControlResultSchema = z.discriminatedUnion('status', [
  z.object({
    controlId: z.string().min(1),
    data: z.unknown().optional(),
    operationId: z.string().min(1),
    status: z.literal('ok'),
  }),
  z.object({
    controlId: z.string().min(1),
    operationId: z.string().min(1),
    status: z.literal('unsupported'),
  }),
  z.object({
    controlId: z.string().min(1),
    error: z.string().max(4000),
    operationId: z.string().min(1),
    status: z.literal('error'),
  }),
]);

/**
 * A `waitHeteroSteer` answer. `control` is present exactly when the poller
 * declared `acceptsControl` — that is how it tells this server apart from one
 * that predates control messages — so an older poller reads the same
 * `{ message, steerable? }` it always did.
 */
type WaitHeteroSteerAnswer = {
  control?: HeteroControlMessage | null;
  message: Awaited<ReturnType<typeof takeHeteroSteer>> | null;
  steerable?: false;
};

/** How often a `waitHeteroSteer` poll re-checks the queue while it holds the request. */
const HETERO_STEER_CHECK_MS = 1500;

/** Sleep `ms`, or less when `signal` aborts first. */
const waitOrAbort = (ms: number, signal: AbortSignal | undefined) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
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

/** Only the user who started the run, still allowed to use its agent, controls its live process. */
const assertControlsHeteroRun = async (
  ctx: { serverDB: LobeChatDatabase; userId: string; workspaceId?: string | null },
  operationId: string,
) => {
  const [operation] = await ctx.serverDB
    .select({ userId: agentOperations.userId })
    .from(agentOperations)
    .where(eq(agentOperations.id, operationId))
    .limit(1);
  if (operation?.userId !== ctx.userId) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Operation not found or not owned by the caller',
    });
  }
  await assertCanUseOperationAgent({
    db: ctx.serverDB,
    operationId,
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
  });
};

export const heteroRouter = router({
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
      const shareVisitor = await resolveHeteroRunShareVisitor({
        db: ctx.serverDB,
        operationId,
        topicId,
      });
      const heteroService = new HeterogeneousAgentService(ctx.serverDB, ctx.userId, {
        shareVisitor,
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
      const shareVisitor = await resolveHeteroRunShareVisitor({
        db: ctx.serverDB,
        operationId,
        topicId,
      });
      const heteroService = new HeterogeneousAgentService(ctx.serverDB, ctx.userId, {
        shareVisitor,
        // Follow-ups queued behind the run start as its next turn through the
        // composer pipeline, under the run owner and its workspace. Not for a
        // share visitor run: that start carries no share gate, so it would run
        // the visitor's queued text as an ungated creator turn.
        startQueuedFollowUp: shareVisitor
          ? undefined
          : (params) =>
              new AiAgentService(ctx.serverDB, ctx.userId, {
                workspaceId: wsId,
              }).startQueuedFollowUp(params),
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
   * Exec-side long-poll for steer messages. `lh hetero exec` calls this in a
   * loop for as long as its Claude Code session takes input; each call holds
   * up to `blockMs` and returns the next follow-up to type into the session,
   * or `null`. Every call also renews the leases of messages the session holds
   * but has not picked up, so they return to the queue only if the run dies.
   *
   * A poller that declares `acceptsControl` also gets the run's control
   * messages (`control`), ahead of follow-ups, each one at most once. A child
   * run takes no follow-ups but still takes control messages: it answers
   * `steerable: false` with `control`, and the poller keeps polling for those.
   */
  waitHeteroSteer: heteroAgentProcedure
    .input(WaitHeteroSteerSchema)
    .mutation(async ({ input, ctx, signal }): Promise<WaitHeteroSteerAnswer> => {
      const {
        acceptsControl,
        acceptsImageAttachments,
        acceptsImages,
        blockMs,
        holdSteer,
        operationId,
      } = input;

      await authorizeOperationCallback(ctx, operationId, 'hetero:ingest');

      const [operation] = await ctx.serverDB
        .select({
          agentId: agentOperations.agentId,
          parentOperationId: agentOperations.parentOperationId,
          threadId: agentOperations.threadId,
          topicId: agentOperations.topicId,
          userId: agentOperations.userId,
          workspaceId: agentOperations.workspaceId,
        })
        .from(agentOperations)
        .where(eq(agentOperations.id, operationId))
        .limit(1);

      if (!operation || operation.userId !== ctx.userId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Operation not found or not owned by the caller',
        });
      }
      // A child run (group member, sub-agent) is not where the user types. Say
      // so, rather than answer an empty poll at once: a producer that takes no
      // control messages stops asking.
      const steerable = !operation.parentOperationId && !!operation.topicId;
      if (!steerable && !acceptsControl) return { message: null, steerable: false };

      const answer = (
        message: WaitHeteroSteerAnswer['message'],
        control: HeteroControlMessage | null = null,
      ): WaitHeteroSteerAnswer => ({
        ...(acceptsControl && { control }),
        message,
        ...(!steerable && { steerable: false as const }),
      });

      const storeCtx = {
        db: ctx.serverDB,
        userId: ctx.userId,
        workspaceId: operation.workspaceId,
      };
      const scope = steerable
        ? { threadId: operation.threadId ?? null, topicId: operation.topicId!, userId: ctx.userId }
        : undefined;

      if (scope) await renewHeteroSteers(operationId);
      // Queue mode leaves the follow-ups to the run end; read once per poll.
      const followUpMode = scope ? await readFollowUpMode(ctx.serverDB, ctx.userId) : undefined;

      const deadline = Date.now() + blockMs;
      for (;;) {
        // The poller went away (its run ended, or the request timed out):
        // take nothing more for it. A follow-up would come back once its
        // lease lapses, but a control message is claimed at most once and
        // would be lost. A poller that leaves between a claim and the answer
        // still loses it; its sender sees `claimed` and times out.
        if (signal?.aborted) return answer(null);
        // Control first: a command (stop a task) should not wait behind follow-ups.
        if (acceptsControl) {
          const control = await takeHeteroControl(operationId);
          if (control) return answer(null, control);
        }
        if (scope && followUpMode !== 'queue' && !holdSteer) {
          const message = await takeHeteroSteer(storeCtx, {
            acceptsImageAttachments,
            acceptsImages,
            agentId: operation.agentId,
            operationId,
            scope,
          });
          if (message) return answer(message);
        }
        if (Date.now() + HETERO_STEER_CHECK_MS > deadline) return answer(null);
        await waitOrAbort(HETERO_STEER_CHECK_MS, signal);
      }
    }),
  /**
   * The session refused a message `waitHeteroSteer` handed out (its input had
   * already closed): put the follow-up back, so it starts the next turn when
   * the run ends.
   */
  returnHeteroSteer: heteroAgentProcedure
    .input(ReturnHeteroSteerSchema)
    .mutation(async ({ input, ctx }) => {
      await authorizeOperationCallback(ctx, input.operationId, 'hetero:ingest', {
        allowTerminalOperation: true,
      });
      const [operation] = await ctx.serverDB
        .select({ userId: agentOperations.userId })
        .from(agentOperations)
        .where(eq(agentOperations.id, input.operationId))
        .limit(1);
      if (operation?.userId !== ctx.userId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Operation not found or not owned by the caller',
        });
      }

      await returnHeteroSteer(input.operationId, input.messageId);
      return { success: true as const };
    }),
  /**
   * The run handled a control message `waitHeteroSteer` handed out: store the
   * result for the server code that queued it. Only the first report for a
   * claimed message counts; `outcome` says whether this one was stored.
   */
  reportHeteroControlResult: heteroAgentProcedure
    .input(ReportHeteroControlResultSchema)
    .mutation(async ({ input, ctx }) => {
      // The run may report just as it ends.
      await authorizeOperationCallback(ctx, input.operationId, 'hetero:ingest', {
        allowTerminalOperation: true,
      });
      const [operation] = await ctx.serverDB
        .select({ userId: agentOperations.userId })
        .from(agentOperations)
        .where(eq(agentOperations.id, input.operationId))
        .limit(1);
      if (operation?.userId !== ctx.userId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Operation not found or not owned by the caller',
        });
      }

      const { controlId, operationId, ...report } = input;
      const outcome = await reportHeteroControlResult(operationId, controlId, report);
      return { outcome };
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
  /**
   * Stop one Claude Code background task of a run hosted by `lh hetero exec`
   * (a connected device, the desktop gateway, the cloud sandbox). The request
   * rides the run's control channel; `accepted` means Claude Code took it, and
   * the task's `stopped` snapshot then arrives through the run's own stream.
   */
  stopHeteroBackgroundTask: aiAgentWriteProcedure
    .input(StopHeteroBackgroundTaskSchema)
    .mutation(async ({ input, ctx }) => {
      await assertControlsHeteroRun(ctx, input.operationId);
      return stopHeteroBackgroundTask(input.operationId, input.taskId);
    }),
  /**
   * Switch the permission mode of a running Claude Code hosted by
   * `lh hetero exec` (the composer's mode chip). Rides the run's control
   * channel; Claude Code's mode report then updates the topic.
   */
  setHeteroPermissionMode: aiAgentWriteProcedure
    .input(SetHeteroPermissionModeSchema)
    .mutation(async ({ input, ctx }) => {
      await assertControlsHeteroRun(ctx, input.operationId);
      return setHeteroPermissionMode(input.operationId, input.mode);
    }),
  /** Flip a running native Codex thread's Plan switch; it applies from the next turn. */
  setHeteroCollaborationMode: aiAgentWriteProcedure
    .input(SetHeteroCollaborationModeSchema)
    .mutation(async ({ input, ctx }) => {
      await assertControlsHeteroRun(ctx, input.operationId);
      return setHeteroCollaborationMode(input.operationId, input.mode);
    }),
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
      log(
        'submitHeteroIntervention: op=%s toolCallId=%s cancelled=%s',
        input.operationId,
        input.toolCallId,
        input.cancelled ?? false,
      );

      await assertCanUseOperationAgent({
        db: ctx.serverDB,
        operationId: input.operationId,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });

      return submitHeteroInterventionAs(input, ctx);
    }),
});
