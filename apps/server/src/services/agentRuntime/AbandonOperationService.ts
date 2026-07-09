import type { ISnapshotStore } from '@lobechat/agent-tracing';
import { LOADING_FLAT } from '@lobechat/const';
import type { ChatMessageError } from '@lobechat/types';
import { AgentRuntimeErrorType } from '@lobechat/types';
import debug from 'debug';
import { and, desc, eq, gte, lte, or } from 'drizzle-orm';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { MessageModel } from '@/database/models/message';
import { ThreadModel } from '@/database/models/thread';
import { TopicModel } from '@/database/models/topic';
import { agentOperations, messages } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
// Direct file import (not the barrel) to avoid pulling in RuntimeExecutors and
// its workspace-package transitive deps in the unit-test environment.
import { AgentRuntimeCoordinator } from '@/server/modules/AgentRuntime/AgentRuntimeCoordinator';

import { CompletionLifecycle } from './CompletionLifecycle';
import { OperationTraceRecorder } from './OperationTraceRecorder';
import { createDefaultSnapshotStore } from './snapshotStore';

const log = debug('lobe-server:abandon-operation');

interface AbandonOperationOptions {
  coordinator?: AgentRuntimeCoordinator;
  snapshotStore?: ISnapshotStore | null;
}

/**
 * Linkage for resuming the parent of an abandoned sub-agent. Surfaced so the
 * caller can run the `completeSubAgentBridge` — the watchdog-abandon path
 * otherwise skips the child's onComplete bridge and strands the parent in
 * `waiting_for_async_tool` forever (the orphaned-parent bug).
 */
export interface AbandonedSubAgentResume {
  parentOperationId: string;
  threadId: string;
  /** The parent's placeholder `role: 'tool'` message to backfill (= thread.sourceMessageId). */
  toolMessageId: string;
  userId: string;
  workspaceId?: string;
}

export interface FinalizeAbandonedResult {
  /**
   * Whether this watchdog firing represents a real abandoned run. `found=false`
   * alone is ambiguous: normal runtime ops may already be cleaned up, while
   * device/hetero runs can have no coordinator state but still be stuck in DB.
   */
  abandoned?: boolean;
  /** Whether the assistant message was successfully marked as errored. */
  assistantMessageUpdated: boolean;
  /** Whether the operation was finalized into a snapshot (false if no partial existed). */
  finalized: boolean;
  /** Whether agent state was found in Redis. */
  found: boolean;
  /**
   * Set when the abandoned op was a sub-agent parked under a parent's
   * `callSubAgent`. The caller MUST bridge this to resume the parent.
   */
  subAgentResume?: AbandonedSubAgentResume;
}

/**
 * Reverse-trigger finalization for an operation whose Vercel function was
 * killed mid-flight. Invoked from a fresh function invocation (e.g. from the
 * agent-gateway DO inactivity watchdog) given just an `operationId`.
 *
 * Loads the agent state from Redis, marks it as errored, runs the same
 * `OperationTraceRecorder.finalize()` path the in-loop error handler would
 * have run, and updates the dangling assistant message in DB.
 *
 * Idempotent: calling twice is a no-op the second time because `finalize()`
 * removes the partial, so `loadAgentState` may return null or finalize will
 * skip due to missing partial.
 */
export class AbandonOperationService {
  private readonly coordinator: AgentRuntimeCoordinator;
  private readonly snapshotStore: ISnapshotStore | null;
  private readonly traceRecorder: OperationTraceRecorder;

  constructor(
    private readonly db: LobeChatDatabase,
    options?: AbandonOperationOptions,
  ) {
    this.coordinator = options?.coordinator ?? new AgentRuntimeCoordinator();
    this.snapshotStore =
      options?.snapshotStore !== undefined ? options.snapshotStore : createDefaultSnapshotStore();
    this.traceRecorder = new OperationTraceRecorder(this.snapshotStore);
  }

  async finalizeAbandoned(operationId: string, reason: string): Promise<FinalizeAbandonedResult> {
    const result: FinalizeAbandonedResult = {
      assistantMessageUpdated: false,
      finalized: false,
      found: false,
    };

    const state = await this.coordinator.loadAgentState(operationId);
    if (!state) {
      log('[%s] no agent state in coordinator — already cleaned up', operationId);
      await this.finalizeRunningOperationWithoutState(operationId, reason, result);
      return result;
    }
    result.found = true;

    const metadata = (state.metadata ?? {}) as {
      assistantMessageId?: string;
      isSubAgent?: boolean;
      orchestrationRole?: 'supervisor' | 'member';
      threadId?: string | null;
      topicId?: string | null;
      userId?: string;
      workspaceId?: string;
    };
    const shouldDispatchAbandonedLifecycle =
      state.status === 'running' ||
      state.status === 'waiting_for_human' ||
      state.status === 'waiting_for_async_tool';
    const message = `Operation abandoned: ${reason}`;
    const error: ChatMessageError = {
      body: { message },
      message,
      type: AgentRuntimeErrorType.AgentRuntimeError,
    };

    // Synthesize a failed-step record at index = lastCompleted + 1 so consumers
    // see the operation ended at a step that never produced data.
    const partial = this.snapshotStore
      ? await this.snapshotStore.loadPartial(operationId).catch(() => null)
      : null;
    const lastStepIndex = partial?.steps?.length
      ? Math.max(...partial.steps.map((s) => s.stepIndex))
      : -1;
    const failedStep = { startedAt: Date.now(), stepIndex: lastStepIndex + 1 };

    // Mutate state for finalize — recorder reads cost / tokens / metadata off this.
    const finalState = { ...state, error, status: 'error' as const };

    if (this.snapshotStore) {
      await this.traceRecorder.finalize(operationId, {
        completionReason: 'error',
        error: { message, type: String(error.type) },
        failedStep,
        state: finalState,
      });
      // finalize swallows its own errors via try/catch, so we treat reaching
      // this line as success. If the partial was missing we still mark the
      // assistant message — that's the more important user-visible signal.
      result.finalized = partial !== null;
    }

    if (metadata.userId && metadata.assistantMessageId) {
      try {
        const messageModel = new MessageModel(this.db, metadata.userId, metadata.workspaceId);
        await messageModel.update(metadata.assistantMessageId, { error });
        result.assistantMessageUpdated = true;
      } catch (e) {
        log('[%s] assistant message update failed (non-fatal): %O', operationId, e);
      }
    }

    if (!metadata.isSubAgent && metadata.userId) {
      if (metadata.topicId) {
        try {
          const topicModel = new TopicModel(this.db, metadata.userId, metadata.workspaceId);
          const topic = await topicModel.findById(metadata.topicId);
          const running = topic?.metadata?.runningOperation as
            { assistantMessageId?: string; operationId?: string } | undefined;
          if (running?.operationId === operationId) {
            await topicModel.updateMetadata(metadata.topicId, { runningOperation: null });
          }
        } catch (e) {
          log('[%s] abandoned op runningOperation cleanup failed (non-fatal): %O', operationId, e);
        }
      }

      if (shouldDispatchAbandonedLifecycle) {
        try {
          await new CompletionLifecycle(
            this.db,
            metadata.userId,
            metadata.workspaceId,
          ).dispatchHooks(operationId, finalState, 'error', {
            skipErrorMessageWrite: result.assistantMessageUpdated,
          });
        } catch (e) {
          log('[%s] abandoned op lifecycle dispatch failed (non-fatal): %O', operationId, e);
        }
      }
    }

    // Resolve sub-agent → parent linkage. The watchdog killed this op without
    // firing its onComplete bridge, so a parent parked on `callSubAgent` would
    // otherwise wait on this slot forever. We surface the ids the caller needs
    // to backfill the placeholder tool message and CAS-resume the parent.
    // parentOperationId + threadId live on the (persistent) operation row;
    // toolMessageId is the thread's sourceMessageId (the parent's placeholder),
    // set when the sub-agent was dispatched. When this is set, the coordinator
    // cleanup below is SKIPPED so the durable resume can still resolve userId.
    //
    // Isolated group members ALSO run with `isSubAgent: true` and an isolation
    // thread, but their parent (supervisor) is resumed through the group K=N
    // bridge (`completeGroupActionMember`, driven by the member's own
    // `scheduleGroupMemberTimeout`) — routing them through the sub-agent bridge
    // would backfill the wrong message and never satisfy the group barrier. They
    // are tagged `orchestrationRole: 'member'`, so skip them here.
    if (metadata.isSubAgent && metadata.orchestrationRole !== 'member' && metadata.userId) {
      try {
        const opRow = await new AgentOperationModel(
          this.db,
          metadata.userId,
          metadata.workspaceId,
        ).findById(operationId);
        const parentOperationId = opRow?.parentOperationId ?? undefined;
        const threadId = opRow?.threadId ?? metadata.threadId ?? undefined;
        if (parentOperationId && threadId) {
          const thread = await new ThreadModel(
            this.db,
            metadata.userId,
            metadata.workspaceId,
          ).findById(threadId);
          const toolMessageId = thread?.sourceMessageId ?? undefined;
          if (toolMessageId) {
            result.subAgentResume = {
              parentOperationId,
              threadId,
              toolMessageId,
              userId: metadata.userId,
              workspaceId: metadata.workspaceId,
            };
          } else {
            log('[%s] sub-agent abandon: thread %s has no sourceMessageId', operationId, threadId);
          }
        }
      } catch (e) {
        // Non-fatal: the parent still has the bounded async-tool verify watchdog
        // as a fallback. Log so a failed resume hand-off stays observable.
        log('[%s] sub-agent parent-resume linkage lookup failed: %O', operationId, e);
      }
    }

    // Skip coordinator cleanup when a parent resume is still pending. The
    // durable subagent-callback (queue mode) re-resolves THIS op's userId from
    // the coordinator metadata, so deleting it now would 401 every redelivery
    // and strand the parent. The lingering state expires on its own Redis TTL.
    if (!result.subAgentResume) {
      try {
        await this.coordinator.deleteAgentOperation(operationId);
      } catch (e) {
        log('[%s] coordinator cleanup failed (non-fatal): %O', operationId, e);
      }
    }

    log('[%s] abandoned op finalized (reason=%s): %O', operationId, reason, result);
    return result;
  }

  private async finalizeRunningOperationWithoutState(
    operationId: string,
    reason: string,
    result: FinalizeAbandonedResult,
  ): Promise<void> {
    const op = await this.findOperationRow(operationId);
    if (!op || !['running', 'waiting_for_human', 'waiting_for_async_tool'].includes(op.status)) {
      return;
    }

    result.abandoned = true;

    const message = `Operation abandoned: ${reason}`;
    const error: ChatMessageError = {
      body: { message },
      message,
      type: AgentRuntimeErrorType.AgentRuntimeError,
    };

    try {
      await new AgentOperationModel(
        this.db,
        op.userId,
        op.workspaceId ?? undefined,
      ).recordCompletion(operationId, {
        completedAt: new Date(),
        completionReason: 'error',
        error: { message, type: String(error.type) },
        llmCalls: 0,
        processingTimeMs: op.startedAt ? Date.now() - new Date(op.startedAt).getTime() : null,
        status: 'error',
        stepCount: 0,
        toolCalls: 0,
        totalTokens: 0,
      });
    } catch (e) {
      log('[%s] no-state abandon: recordCompletion failed (non-fatal): %O', operationId, e);
    }

    const assistantMessageId = await this.resolveAssistantMessageIdForOperation(op, operationId);
    if (!assistantMessageId) return;

    try {
      const messageModel = new MessageModel(this.db, op.userId, op.workspaceId ?? undefined);
      await messageModel.update(assistantMessageId, { content: '', error });
      result.assistantMessageUpdated = true;
    } catch (e) {
      log('[%s] no-state abandon: assistant message update failed (non-fatal): %O', operationId, e);
    }
  }

  private async findOperationRow(operationId: string) {
    try {
      return await (this.db as any).query?.agentOperations?.findFirst({
        where: eq(agentOperations.id, operationId),
      });
    } catch (e) {
      log('[%s] no-state abandon: operation lookup failed (non-fatal): %O', operationId, e);
      return null;
    }
  }

  private async resolveAssistantMessageIdForOperation(
    op: typeof agentOperations.$inferSelect,
    operationId: string,
  ): Promise<string | undefined> {
    let topicModel: TopicModel | undefined;

    if (op.topicId) {
      try {
        topicModel = new TopicModel(this.db, op.userId, op.workspaceId ?? undefined);
        const topic = await topicModel.findById(op.topicId);
        const running = topic?.metadata?.runningOperation as
          { assistantMessageId?: string; operationId?: string } | undefined;

        if (running?.operationId && running.operationId !== operationId) return undefined;

        if (running?.operationId === operationId) {
          await topicModel.updateMetadata(op.topicId, { runningOperation: null }).catch(() => {});
          if (running.assistantMessageId) return running.assistantMessageId;
        }
      } catch (e) {
        log('[%s] no-state abandon: topic lookup failed (non-fatal): %O', operationId, e);
      }
    }

    try {
      const startedAt = op.startedAt ? new Date(op.startedAt) : undefined;
      const lowerBound = startedAt ? new Date(startedAt.getTime() - 5000) : undefined;
      const upperBound = startedAt ? new Date(startedAt.getTime() + 5000) : undefined;
      const assistant = await (this.db as any).query?.messages?.findFirst({
        orderBy: [desc(messages.createdAt)],
        where: and(
          eq(messages.userId, op.userId),
          eq(messages.role, 'assistant'),
          op.topicId ? eq(messages.topicId, op.topicId) : undefined,
          op.agentId ? eq(messages.agentId, op.agentId) : undefined,
          op.provider ? eq(messages.provider, op.provider) : undefined,
          lowerBound ? gte(messages.createdAt, lowerBound) : undefined,
          upperBound ? lte(messages.createdAt, upperBound) : undefined,
          or(eq(messages.content, LOADING_FLAT), eq(messages.content, '')),
        ),
      });

      return assistant?.id;
    } catch (e) {
      log('[%s] no-state abandon: assistant lookup failed (non-fatal): %O', operationId, e);
      return undefined;
    }
  }
}
