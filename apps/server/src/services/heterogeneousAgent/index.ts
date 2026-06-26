import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import type { ISnapshotStore } from '@lobechat/agent-tracing';
import type { LobeChatDatabase } from '@lobechat/database';
import debug from 'debug';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { MessageModel } from '@/database/models/message';
import { ThreadModel } from '@/database/models/thread';
import { TopicModel } from '@/database/models/topic';
import { createStreamEventManager } from '@/server/modules/AgentRuntime/factory';
import { type IStreamEventManager } from '@/server/modules/AgentRuntime/types';
import { dispatchTerminalHooks } from '@/server/services/agentRuntime/hooks';
import type { SerializedHook } from '@/server/services/agentRuntime/hooks/types';
import { createDefaultSnapshotStore } from '@/server/services/agentRuntime/snapshotStore';

import {
  HeterogeneousPersistenceHandler,
  StaleHeteroOperationError,
} from './HeterogeneousPersistenceHandler';
import { HeteroTraceRecorder } from './HeteroTraceRecorder';

const log = debug('lobe-server:hetero-agent-service');

export type HeterogeneousAgentType = 'claude-code' | 'codex';

export type HeterogeneousFinishResult = 'success' | 'error' | 'cancelled';

export interface HeterogeneousIngestParams {
  agentType: HeterogeneousAgentType;
  /** Forwarded from the sandbox LOBEHUB_ASSISTANT_MESSAGE_ID env var.
   * Passed through to the persistence handler so loadOrCreateState can skip
   * the topic.metadata DB read on cold Lambda instances. */
  assistantMessageId?: string;
  events: AgentStreamEvent[];
  operationId: string;
  topicId: string;
}

export interface HeterogeneousFinishParams {
  agentType: HeterogeneousAgentType;
  error?: { message: string; type: string };
  operationId: string;
  result: HeterogeneousFinishResult;
  /**
   * Native CLI session id (e.g. CC's per-cwd session). Used in phase 2c to
   * persist on `topic.metadata` so a subsequent `lh hetero exec` run can
   * resume context.
   */
  sessionId?: string;
  topicId: string;
}

export interface HeterogeneousAgentServiceOptions {
  /** Inject a pre-built persistence handler (used by tests). */
  persistenceHandler?: HeterogeneousPersistenceHandler;
  /** Inject a snapshot store (used by tests); defaults to the env-resolved store. */
  snapshotStore?: ISnapshotStore | null;
  /** Inject a pre-built manager (used by tests). */
  streamEventManager?: IStreamEventManager;
  /** Inject a pre-built TopicModel (used by tests for the resume helper). */
  topicModel?: TopicModel;
  /**
   * Workspace id for scoping internal model reads/writes (messages, topics,
   * threads). Falls back to user-personal scope when omitted.
   */
  workspaceId?: string;
}

/**
 * Server-side ingest handler for heterogeneous agent CLIs (`lh hetero exec`
 * for Claude Code / Codex). Receives `AgentStreamEvent` batches from the
 * producer and republishes them through the existing `StreamEventManager`
 * fanout, so renderer-side gateway WS subscribers see the same wire shape
 * regardless of whether the run came from the agent gateway or a CLI process.
 *
 * Phase 2a scope: pure pub/sub. Phase 2b adds DB persistence via
 * `HeterogeneousPersistenceHandler`. Phase 2c persists `sessionId` to
 * `topic.metadata.heterogeneousSessions`.
 */
export class HeterogeneousAgentService {
  private readonly db: LobeChatDatabase;
  private readonly messageModel: MessageModel;
  private readonly operationModel: AgentOperationModel;
  private readonly persistenceHandler: HeterogeneousPersistenceHandler;
  private readonly streamEventManager: IStreamEventManager;
  private readonly topicModel: TopicModel;
  private readonly traceRecorder: HeteroTraceRecorder;
  private readonly userId: string;

  constructor(
    db: LobeChatDatabase,
    userId: string,
    options: HeterogeneousAgentServiceOptions = {},
  ) {
    this.db = db;
    this.userId = userId;
    const workspaceId = options.workspaceId;
    this.messageModel = new MessageModel(db, userId, workspaceId);
    this.operationModel = new AgentOperationModel(db, userId, workspaceId);
    this.streamEventManager = options.streamEventManager ?? createStreamEventManager();
    this.topicModel = options.topicModel ?? new TopicModel(db, userId, workspaceId);
    this.traceRecorder = new HeteroTraceRecorder(
      options.snapshotStore !== undefined ? options.snapshotStore : createDefaultSnapshotStore(),
    );
    this.persistenceHandler =
      options.persistenceHandler ??
      new HeterogeneousPersistenceHandler({
        messageModel: this.messageModel,
        threadModel: new ThreadModel(db, userId, workspaceId),
        topicModel: this.topicModel,
      });
  }

  async heteroIngest(params: HeterogeneousIngestParams): Promise<void> {
    const { agentType, assistantMessageId, events, operationId, topicId } = params;

    log(
      'heteroIngest: user=%s topic=%s op=%s type=%s count=%d',
      this.userId,
      topicId,
      operationId,
      agentType,
      events.length,
    );

    // Persist FIRST, then publish — the renderer's gateway handler triggers
    // `fetchAndReplaceMessages` on stream_start / tool_end / step_complete,
    // so DB must already reflect the latest writes when the WS event lands.
    // Persistence failures throw so the CLI BatchIngester retries the batch;
    // events that already landed are skipped via the handler's idempotency
    // map keyed on (stepIndex, type, timestamp).
    try {
      await this.persistenceHandler.ingest({ assistantMessageId, events, operationId, topicId });
    } catch (err) {
      if (err instanceof StaleHeteroOperationError) {
        log(
          'heteroIngest: ignore stale batch topic=%s op=%s: %s',
          topicId,
          operationId,
          err.message,
        );
        return;
      }
      throw err;
    }

    // Sequential publish preserves stepIndex ordering — Redis XADD itself is
    // serialized but awaiting in-order avoids interleaving with concurrent
    // ingest batches sharing the same operationId.
    for (const event of events) {
      // Each event already carries operationId; pass through unchanged so the
      // wire shape on the WS side is identical to gateway-driven runs.
      await this.streamEventManager.publishStreamEvent(operationId, {
        data: event.data,
        stepIndex: event.stepIndex,
        type: event.type,
      });
    }

    // Accumulate the execution-trace snapshot LAST. The recorder has no
    // per-event idempotency, so it must run only after every step that can throw
    // and trigger a BatchIngester retry of this same batch — otherwise a publish
    // failure above would re-fold these events and double-count the snapshot.
    // It's the final statement and best-effort (never throws), so it folds each
    // batch exactly once (on the attempt that gets this far).
    await this.traceRecorder.appendBatch(operationId, events);
  }

  async heteroFinish(params: HeterogeneousFinishParams): Promise<void> {
    const { agentType, error, operationId, result, sessionId, topicId } = params;

    log(
      'heteroFinish: user=%s topic=%s op=%s type=%s result=%s sessionId=%s',
      this.userId,
      topicId,
      operationId,
      agentType,
      result,
      sessionId ?? '<none>',
    );

    // Drain any pending state in the persistence handler — flushes trailing
    // accumulated content / reasoning that the in-stream `agent_runtime_end`
    // already wrote (no-op when state is clean), persists the CLI's native
    // session id for next-turn resume, and frees the per-operation memory.
    await this.persistenceHandler.finish({ error, operationId, result, sessionId });

    // Always emit a terminal `agent_runtime_end` so renderer subscribers shut
    // down even if the CLI stream missed it (process killed mid-flight,
    // network drop on last batch). Idempotent on the renderer side: the
    // gateway event handler latches `terminalState` on first end-event.
    await this.streamEventManager.publishStreamEvent(operationId, {
      data: {
        agentType,
        error,
        operationId,
        reason: result,
        sessionId,
      },
      stepIndex: 0,
      type: 'agent_runtime_end',
    });

    // Drive the run's lifecycle hooks (onComplete / onError) through the same
    // `hookDispatcher` the normal LLM runtime uses, so the task lifecycle
    // (onTopicComplete → task done/failed) and any IM bot completion callback
    // fire uniformly. The hooks were registered in-memory (local mode) and
    // serialized onto runningOperation (queue mode) at dispatch time.
    //
    // Skip on `cancelled` — heteroFinish may be called twice: first with
    // result=cancelled (termination signal) then with result=success/error
    // (normal process exit). We must NOT clear runningOperation or fire hooks on
    // cancelled so the subsequent success/error call still finds the hooks +
    // assistantMessageId and dispatches exactly once. (cancelled→interrupted is a
    // no-op for the task lifecycle anyway — onTopicComplete has no interrupted
    // branch — and suppresses a spurious bot "stopped" message before the real
    // result lands.)
    if (result === 'cancelled') return;

    let serializedHooks: SerializedHook[] | undefined;
    let assistantMessageId: string | undefined;
    try {
      const topic = await this.topicModel.findById(topicId);
      serializedHooks = topic?.metadata?.runningOperation?.hooks as SerializedHook[] | undefined;
      // Prefer heteroCurrentMsgId — the persistence handler updates this pointer
      // on every step boundary, so it refers to the LAST assistant message with
      // the complete final content.  Fall back to the initial placeholder id
      // recorded in runningOperation if the pointer is absent or belongs to a
      // different operation (shouldn't happen, but defensive).
      const currentMsgRef = topic?.metadata?.heteroCurrentMsgId;
      assistantMessageId =
        currentMsgRef?.operationId === operationId
          ? currentMsgRef.msgId
          : topic?.metadata?.runningOperation?.assistantMessageId;
      await this.topicModel.updateMetadata(topicId, { runningOperation: null });
    } catch (err) {
      log('heteroFinish: failed to clear runningOperation (non-fatal): %O', err);
    }

    // Read the final assistant content + owning agent so the bot-callback
    // handler has lastAssistantContent to render and the event carries agentId.
    let lastAssistantContent: string | undefined;
    let agentId: string | undefined;
    if (assistantMessageId) {
      try {
        const msg = await this.messageModel.findById(assistantMessageId);
        lastAssistantContent = msg?.content as string | undefined;
        agentId = msg?.agentId ?? undefined;
      } catch (err) {
        log('heteroFinish: failed to read final assistant message (non-fatal): %O', err);
      }
    }

    // Finalize the trace snapshot + write the operation's terminal state. Runs
    // on the real terminal only (cancelled returned above), so a run gets one
    // snapshot + one completion. Aggregates come from the accumulated steps;
    // missing fields stay null (schema treats null as "not measured"). This
    // makes the hetero run a verify/tracing peer of the built-in agent.
    // `result` is narrowed to 'success' | 'error' here — 'cancelled' returned above.
    const completionReason = result === 'success' ? ('done' as const) : ('error' as const);
    try {
      const totals = await this.traceRecorder.finalize(operationId, {
        agentId,
        completionReason,
        error,
        topicId,
        userId: this.userId,
      });
      await this.operationModel.recordCompletion(operationId, {
        completedAt: new Date(),
        completionReason,
        error: error ?? null,
        llmCalls: totals?.llmCalls ?? null,
        // Backfill the real executed model/provider resolved from the CLI stream
        // (recordStart could only seed provider=heteroType + model=null at
        // dispatch). Spread conditionally so a run without a model event keeps the
        // seeded values instead of getting clobbered back to null.
        ...(totals?.model ? { model: totals.model } : {}),
        ...(totals?.provider ? { provider: totals.provider } : {}),
        status: completionReason,
        stepCount: totals?.stepCount ?? null,
        toolCalls: totals?.toolCalls ?? null,
        totalCost: totals?.totalCost ?? null,
        totalInputTokens: totals?.totalInputTokens ?? null,
        totalOutputTokens: totals?.totalOutputTokens ?? null,
        totalTokens: totals?.totalTokens ?? null,
        traceS3Key: totals?.traceS3Key ?? null,
      });
    } catch (err) {
      log('heteroFinish: recordCompletion/finalize failed (non-fatal): %O', err);
    }

    await dispatchTerminalHooks({
      agentId,
      ...(error ? { errorMessage: error.message, errorType: error.type } : {}),
      lastAssistantContent,
      operationId,
      reason: result === 'success' ? 'done' : 'error',
      serializedHooks,
      topicId,
      userId: this.userId,
    });
    log('heteroFinish: dispatched terminal hooks for op=%s result=%s', operationId, result);
  }

  /**
   * Look up the persisted CLI session id for a topic so the orchestrator
   * (phase 3 cloud sandbox) can pass `--resume <sessionId>` to the next
   * `lh hetero exec` spawn. Returns undefined when no prior run completed
   * on this topic — caller should spawn fresh.
   *
   * Reads the same `topic.metadata.heteroSessionId` the desktop renderer
   * writes, so resume state is shared between desktop and cloud paths.
   */
  async getHeterogeneousResumeSessionId(topicId: string): Promise<string | undefined> {
    const topic = await this.topicModel.findById(topicId);
    return topic?.metadata?.heteroSessionId;
  }
}

export {
  HeterogeneousPersistenceHandler,
  StaleHeteroOperationError,
} from './HeterogeneousPersistenceHandler';
