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
  /**
   * When true, the parent op is a shared-agent visitor run (its metadata
   * carries `streamOwnerUserId`). The inline resume path must construct
   * services with `includeShareVisitor: true` so the visitor-owned rows
   * remain visible.
   */
  streamOwnerUserId?: string;
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
      /** Present only for shared-agent visitor runs (visitor owns the stream). */
      streamOwnerUserId?: string;
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

    // Shared-agent visitor runs mark themselves with `streamOwnerUserId` on
    // the operation metadata (the op executes as the creator `userId`, but the
    // visitor owns the stream). The visitor-owned rows are excluded from
    // MessageModel/TopicModel/CompletionLifecycle by default, so the cleanup
    // path must opt in when this flag is present.
    const includeShareVisitor = Boolean(metadata.streamOwnerUserId);

    if (metadata.userId) {
      // `assistantMessageId` is only set once a step has created its
      // placeholder. A step killed before its first token — the usual shape
      // when the host is recycled mid-LLM-call — never created one, so there
      // is nothing to mark and the turn ends up carrying no error at all. The
      // client keys its retry affordance off `message.error`, so that silence
      // is exactly why an abandoned turn renders as frozen rather than failed.
      // Fall back to the conversation's tail message so the failure always has
      // somewhere to land.
      const targetMessageId =
        metadata.assistantMessageId ??
        (metadata.topicId
          ? await this.resolveTailMessageId(
              {
                threadId: metadata.threadId,
                topicId: metadata.topicId,
                userId: metadata.userId,
                workspaceId: metadata.workspaceId,
              },
              includeShareVisitor,
            )
          : undefined);

      if (targetMessageId) {
        try {
          const messageModel = new MessageModel(
            this.db,
            metadata.userId,
            metadata.workspaceId,
            undefined,
            { includeShareVisitor },
          );
          await messageModel.update(targetMessageId, { error });
          result.assistantMessageUpdated = true;
        } catch (e) {
          log('[%s] assistant message update failed (non-fatal): %O', operationId, e);
        }
      }
    }

    if (metadata.topicId && metadata.userId) {
      try {
        const topicModel = new TopicModel(
          this.db,
          metadata.userId,
          metadata.workspaceId,
          undefined,
          { includeShareVisitor },
        );
        await topicModel.settleRunningOperation(metadata.topicId, operationId);
      } catch (e) {
        log('[%s] abandoned op runningOperation cleanup failed (non-fatal): %O', operationId, e);
      }
    }

    if (!metadata.isSubAgent && metadata.userId && shouldDispatchAbandonedLifecycle) {
      try {
        await new CompletionLifecycle(this.db, metadata.userId, metadata.workspaceId, {
          includeShareVisitor,
        }).dispatchHooks(operationId, finalState, 'error', {
          skipErrorMessageWrite: result.assistantMessageUpdated,
        });
      } catch (e) {
        log('[%s] abandoned op lifecycle dispatch failed (non-fatal): %O', operationId, e);
      }
    }

    // Safety net for the durable row. `dispatchHooks` owns the rich terminal
    // write (step count, usage, cost, traceS3Key) via `persistCompletion`, but
    // it only runs behind the guard above: a sub-agent, a missing
    // `metadata.userId`, or a state whose `status` is not one of
    // running/waiting_* (e.g. a step boundary persisted as `idle`) all skip it
    // silently, and a throw inside it is swallowed as non-fatal. Any of those
    // used to leave the operation `running` forever — nothing else retires a
    // non-Goal op, so it stayed live on the dashboard and blocked its own
    // recovery. `settleRunning` is idempotent and only matches rows still in
    // `running`, so it cannot overwrite the richer outcome when the dispatch
    // did happen.
    if (metadata.userId) {
      try {
        const settled = await new AgentOperationModel(
          this.db,
          metadata.userId,
          metadata.workspaceId,
        ).settleRunning(operationId, 'error');
        if (settled) {
          log('[%s] durable row settled by abandon safety net', operationId);
        }
      } catch (e) {
        log('[%s] abandon safety-net settle failed (non-fatal): %O', operationId, e);
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
              // Forward the visitor-run marker so an inline resume (local mode)
              // constructs its services with `includeShareVisitor: true`; the
              // queue-mode `subagent-callback` re-derives the same flag from
              // the parent op's coordinator metadata.
              streamOwnerUserId: metadata.streamOwnerUserId,
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
      // No-state cleanup path: this is a system-side finalize keyed on ids
      // read from the persisted `agentOperations` row (no user input), and the
      // op may belong to a shared-agent visitor conversation whose rows the
      // default MessageModel gate would hide. Opt in unconditionally so the
      // placeholder can still be marked errored when the coordinator state has
      // already evaporated.
      const messageModel = new MessageModel(
        this.db,
        op.userId,
        op.workspaceId ?? undefined,
        undefined,
        { includeShareVisitor: true },
      );
      await messageModel.update(assistantMessageId, { content: '', error });
      result.assistantMessageUpdated = true;
    } catch (e) {
      log('[%s] no-state abandon: assistant message update failed (non-fatal): %O', operationId, e);
    }
  }

  /**
   * Anchor for an abandonment error when the dying step never created its own
   * assistant placeholder: the latest main-chain message of the run.
   *
   * Reuses the same spine query the runtime itself uses to pick a turn's
   * continuation point, so the error lands on the node the client is actually
   * rendering as the tail rather than on a tool child or a stale fork.
   */
  private async resolveTailMessageId(
    params: { threadId?: string | null; topicId: string; userId: string; workspaceId?: string },
    includeShareVisitor: boolean,
  ): Promise<string | undefined> {
    try {
      const messageModel = new MessageModel(this.db, params.userId, params.workspaceId, undefined, {
        includeShareVisitor,
      });
      return await messageModel.getLatestSpineMessageId({
        threadId: params.threadId ?? null,
        topicId: params.topicId,
      });
    } catch (e) {
      log('[%s] tail message lookup failed (non-fatal): %O', params.topicId, e);
      return undefined;
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
        // No-state cleanup path: same rationale as the MessageModel above —
        // system-side finalize keyed on ids from the persisted operation row,
        // and the op may belong to a shared-agent visitor topic that the
        // default TopicModel gate would exclude. Opt in unconditionally.
        topicModel = new TopicModel(this.db, op.userId, op.workspaceId ?? undefined, undefined, {
          includeShareVisitor: true,
        });
        const settled = await topicModel.settleRunningOperation(op.topicId, operationId);
        if (settled.status !== 'settled') return undefined;
        if (settled.assistantMessageId) return settled.assistantMessageId;
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
