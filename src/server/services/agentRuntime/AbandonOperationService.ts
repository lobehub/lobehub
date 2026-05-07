import type { ISnapshotStore } from '@lobechat/agent-tracing';
import type { ChatMessageError } from '@lobechat/types';
import { AgentRuntimeErrorType } from '@lobechat/types';
import debug from 'debug';

import { MessageModel } from '@/database/models/message';
import type { LobeChatDatabase } from '@/database/type';
// Direct file import (not the barrel) to avoid pulling in RuntimeExecutors and
// its workspace-package transitive deps in the unit-test environment.
import { AgentRuntimeCoordinator } from '@/server/modules/AgentRuntime/AgentRuntimeCoordinator';

import { OperationTraceRecorder } from './OperationTraceRecorder';

const log = debug('lobe-server:abandon-operation');

interface AbandonOperationOptions {
  coordinator?: AgentRuntimeCoordinator;
  snapshotStore?: ISnapshotStore | null;
}

export interface FinalizeAbandonedResult {
  /** Whether the assistant message was successfully marked as errored. */
  assistantMessageUpdated: boolean;
  /** Whether the operation was finalized into a snapshot (false if no partial existed). */
  finalized: boolean;
  /** Whether agent state was found in Redis. */
  found: boolean;
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
      return result;
    }
    result.found = true;

    const metadata = (state.metadata ?? {}) as { assistantMessageId?: string; userId?: string };
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
        const messageModel = new MessageModel(this.db, metadata.userId);
        await messageModel.update(metadata.assistantMessageId, { error });
        result.assistantMessageUpdated = true;
      } catch (e) {
        log('[%s] assistant message update failed (non-fatal): %O', operationId, e);
      }
    }

    try {
      await this.coordinator.deleteAgentOperation(operationId);
    } catch (e) {
      log('[%s] coordinator cleanup failed (non-fatal): %O', operationId, e);
    }

    log('[%s] abandoned op finalized (reason=%s): %O', operationId, reason, result);
    return result;
  }
}

function createDefaultSnapshotStore(): ISnapshotStore | null {
  if (process.env.ENABLE_AGENT_S3_TRACING === '1') {
    try {
      const { S3SnapshotStore } = require('@/server/modules/AgentTracing');
      return new S3SnapshotStore();
    } catch {
      /* S3SnapshotStore not available */
    }
  }

  if (process.env.NODE_ENV === 'development') {
    try {
      const { FileSnapshotStore } = require('@lobechat/agent-tracing');
      return new FileSnapshotStore();
    } catch {
      /* agent-tracing not available */
    }
  }

  return null;
}
