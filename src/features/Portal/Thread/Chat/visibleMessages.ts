/** A message identity and its owning thread, before rendering. */
interface ThreadMessageIdentity {
  children?: readonly ThreadMessageIdentity[];
  id: string;
  threadId?: string | null;
}

/**
 * Selects the visible portion of a thread without exposing inherited rows for mutation.
 *
 * Use when:
 * - Rendering a thread portal with an included or excluded source message.
 * Expects:
 * - Messages are ordered and retain their owning thread IDs.
 * Returns:
 * - Visible IDs, inherited read-only IDs, and the displayed source anchor.
 * - Undefined visibility keeps the unanchored optimistic view.
 */
export const getThreadMessageView = (
  messages: readonly ThreadMessageIdentity[],
  sourceMessageId?: string,
  threadId?: string,
  sourceMessageExcluded = false,
) => {
  const source = messages.find(
    (message) =>
      message.id === sourceMessageId ||
      message.children?.some((child) => child.id === sourceMessageId),
  );
  const ownedIds = new Set(
    messages
      .filter((message) => threadId && message.threadId === threadId)
      .map((message) => message.id),
  );
  const readOnlyIds = new Set(
    messages
      .filter((message) => threadId && message.threadId !== threadId)
      .map((message) => message.id),
  );
  if (source) readOnlyIds.add(source.id);
  const forkIndex = source ? messages.indexOf(source) : -1;
  // The previous absent-anchor fallback showed everything. Keep it only for the optimistic
  // unpersisted view; saved threads must never expose inherited rows through that fallback.
  const visibleIds =
    sourceMessageExcluded || (threadId && forkIndex < 0)
      ? ownedIds
      : forkIndex < 0
        ? undefined
        : new Set(messages.slice(forkIndex).map((message) => message.id));
  return { readOnlyIds, sourceDisplayMessageId: source?.id, visibleIds };
};
