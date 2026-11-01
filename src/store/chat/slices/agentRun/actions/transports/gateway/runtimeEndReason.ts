import type { ChatMessageError, UIChatMessage } from '@lobechat/types';

// `agent_runtime_end` reasons that are NOT a clean completion: a mid-stream
// cancel, a deferred-tool park, and a failed run (the server runtime ends an
// errored op with its `error` status; `heteroFinish` reports `error` /
// `cancelled`). These must NOT mark the topic unread, and must take the
// non-success branch in `onSessionComplete` so the run clears back to 'active'
// rather than persisting as an unread completion.
const NON_COMPLETION_RUNTIME_END_REASONS = new Set([
  'cancelled',
  'error',
  'interrupted',
  'waiting_for_async_tool',
]);

/**
 * Whether an `agent_runtime_end` event represents a clean completion (vs. a
 * cancel / park / failure). A clean completion is the only ending that should
 * surface an unread badge.
 */
export const isCompletedRuntimeEnd = (reason?: string | null): boolean =>
  !NON_COMPLETION_RUNTIME_END_REASONS.has(reason ?? '');

/** Terminal run status an `agent_runtime_end` reason settles to. */
export const resolveRuntimeEndStatus = (
  reason?: string | null,
): 'cancelled' | 'completed' | 'failed' => {
  if (reason === 'error') return 'failed';

  return isCompletedRuntimeEnd(reason) ? 'completed' : 'cancelled';
};

/**
 * Error persisted on the run's last assistant row. A hetero run arrives as one
 * `assistantGroup` whose failed step is its last child.
 */
export const findTerminalAssistantError = (
  messages: UIChatMessage[] | undefined,
): ChatMessageError | undefined => {
  const last = messages?.findLast(
    (message) => message.role === 'assistant' || message.role === 'assistantGroup',
  );

  return (last?.children?.at(-1)?.error ?? last?.error) || undefined;
};
