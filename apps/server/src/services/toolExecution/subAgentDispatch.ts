/**
 * Content for an async sub-agent dispatch tool result (`wait !== true`).
 *
 * This string IS the tool result the model reads, so it must carry everything
 * the model needs to act on a non-blocking dispatch: the thread id (both the
 * continuation handle and the `lh` query handle), how to poll, and the fact
 * that the real result arrives later instead of in this turn.
 */
export const buildAsyncSubAgentDispatchContent = (
  threadId: string,
  options?: { continuationHint?: string },
): string =>
  [
    `Sub-agent dispatched (threadId: ${threadId}) — it runs in the background; its result will NOT appear in this turn.`,
    '',
    `- Check progress: \`lh thread view ${threadId}\``,
    ...(options?.continuationHint ? [`- ${options.continuationHint}`] : []),
    "- Its final result is written back to this conversation's sub-agent card when it completes.",
  ].join('\n');
