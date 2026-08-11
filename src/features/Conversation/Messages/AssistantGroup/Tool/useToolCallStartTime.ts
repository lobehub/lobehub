import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/slices/operation/selectors';

import { dataSelectors, useConversationStore } from '../../../store';

/**
 * Baseline time for a tool call's execution timer.
 *
 * The operation carries the exact execution start, but it only exists on the
 * client-runtime path and lives in memory: heterogeneous agents (Claude Code /
 * Codex) never create one, and a reload or a long unmount drops it — the timer
 * then restarted from mount time, so a tool running for half an hour read as
 * "3.3s". The tool row is written when the call is *issued* on both paths, so
 * its `createdAt` is a durable fallback baseline.
 *
 * Operation first, because it is the truer execution start: on the human
 * approval flow the tool row is created when approval is requested, so its
 * `createdAt` would fold the user's thinking time into the elapsed time.
 */
export const useToolCallStartTime = (toolCallId: string): number | undefined => {
  const runningStartTime = useChatStore(operationSelectors.getRunningToolCallStartTime(toolCallId));
  const toolMessageCreatedAt = useConversationStore(
    dataSelectors.getToolMessageCreatedAt(toolCallId),
  );

  return runningStartTime ?? toolMessageCreatedAt;
};
