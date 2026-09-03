import { useCallback, useEffect, useState } from 'react';

import { shareChatService } from '@/services/shareChat';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/slices/operation/selectors';
import { AI_RUNTIME_OPERATION_TYPES, type Operation } from '@/store/chat/slices/operation/types';

export interface ShareRunStop {
  /** Set when the interrupt request itself failed — lets the caller offer a retry. */
  stopError: unknown;
  /** Whether an interrupt request is currently in flight. */
  stopping: boolean;
  /**
   * Ask the server to interrupt the share's currently running operation.
   * No-op if nothing is running for this (agentId, topicId) context.
   */
  stopSharedRun: () => Promise<void>;
}

/**
 * The bits `stopSharedRun` needs off the running operation: the server-side id
 * `shareChat.interruptTask` requires (distinct from the local operation id),
 * and the topic it belongs to (read off the operation itself rather than the
 * composer's `topicId` prop, which can still be stale for the first turn of a
 * brand-new topic — see `resolveRunningShareOperation`'s doc comment).
 */
export interface RunningShareOperation {
  localOperationId: string;
  serverOperationId: string;
  topicId: string;
}

/**
 * Pick the running gateway operation for a share context, if any — pure so it
 * can be unit-tested without a full zustand store mock (see
 * `useShareRunStop.test.ts`, mirroring the `topicPanelViewState.ts` precedent).
 *
 * Reads `operation.context.topicId` rather than trusting a caller-supplied
 * topicId: for a fresh share topic the operation is created (and starts
 * streaming) with the server-minted topic id before `VisitorConversation`'s
 * `activeTopicId` state has necessarily re-rendered the composer, so the prop
 * can momentarily lag. The operation's own context never does.
 */
export const resolveRunningShareOperation = (
  operations: Operation[],
): RunningShareOperation | undefined => {
  const operation = operations.find(
    (op) => AI_RUNTIME_OPERATION_TYPES.includes(op.type) && op.status === 'running',
  );
  if (!operation?.metadata.serverOperationId || !operation.context.topicId) return undefined;

  return {
    localOperationId: operation.id,
    serverOperationId: operation.metadata.serverOperationId,
    topicId: operation.context.topicId,
  };
};

/**
 * Visitor-facing counterpart of the main composer's Stop button.
 *
 * Deliberately does NOT go through `cancelOperation`/`cancelOperations`: those
 * already forward gateway-mode share runs to `shareChatService.interruptTask`
 * via the `onOperationCancel` handler registered in `gateway.ts`, but that
 * call is fire-and-forget and swallows its own errors (see
 * `operation/actions.ts` `cancelOperation`), so a failed interrupt would never
 * reach the visitor. Worse, the server's `interruptTask` route rejects with
 * `NOT_FOUND` unless the given operationId still matches the topic's recorded
 * `runningOperation` (see `shareChat.ts`), so calling it a second time
 * ourselves on top of that handler risks a spurious failure once the first
 * call has already cleared it. Instead this owns the single interrupt call
 * end-to-end and reports its outcome.
 *
 * Flips `isAborting` on the local operation immediately on request (the same
 * flag `cancelOperation` sets) so the busy indicator clears right away like
 * the main composer's, without touching `onCancelHandler` — and reverts it if
 * the interrupt request itself fails, since the run is presumably still going.
 */
export const useShareRunStop = (
  shareId: string,
  agentId: string,
  topicId?: string | null,
): ShareRunStop => {
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<unknown>();

  // The failure belongs to the run in the topic it happened in; carrying it into
  // another topic would offer a retry that resolves no running operation there.
  useEffect(() => {
    setStopError(undefined);
  }, [topicId]);

  const stopSharedRun = useCallback(async () => {
    if (stopping) return;

    const operations = operationSelectors.getOperationsByContext({
      agentId,
      scope: 'main',
      topicId: topicId ?? undefined,
    })(useChatStore.getState());
    const target = resolveRunningShareOperation(operations);
    if (!target) return;

    const { updateOperationMetadata } = useChatStore.getState();
    setStopping(true);
    setStopError(undefined);
    updateOperationMetadata(target.localOperationId, { isAborting: true });

    try {
      await shareChatService.interruptTask(shareId, target.topicId, target.serverOperationId);
    } catch (error) {
      console.error('[AgentShareVisitor] interruptTask failed:', error);
      // The interrupt didn't land — the run is presumably still going, so
      // restore the loading indicator and let the visitor retry.
      updateOperationMetadata(target.localOperationId, { isAborting: false });
      setStopError(error);
    } finally {
      setStopping(false);
    }
  }, [agentId, shareId, stopping, topicId]);

  return { stopError, stopping, stopSharedRun };
};
