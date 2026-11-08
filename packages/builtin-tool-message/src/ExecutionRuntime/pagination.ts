import type { ReadMessagesParams, ReadMessagesState } from '../types';

/** Discord has no has_more flag: expose real IDs, not an inferred availability claim. */
export const describeDiscordPagination = (
  params: ReadMessagesParams,
  result: ReadMessagesState,
): string => {
  const messages = result.messages;
  if (!Array.isArray(messages)) {
    return '\n\n[Pagination blocked: the response did not contain a message page. Do not claim history is complete.]';
  }
  if (messages.length === 0) {
    return '\n\n[No messages returned for this request. Stop this traversal of visible history; this does not prove the channel has no inaccessible history.]';
  }

  // Snowflakes exceed Number.MAX_SAFE_INTEGER. Do not depend on response ordering.
  if (messages.some((message) => typeof message.id !== 'string' || !/^\d+$/.test(message.id))) {
    return '\n\n[Pagination blocked: a message ID is not a decimal string. Do not invent a cursor.]';
  }
  const ids = messages.map((message) => message.id);
  const oldest = ids.reduce((a, b) => (BigInt(a) < BigInt(b) ? a : b));
  const newest = ids.reduce((a, b) => (BigInt(a) > BigInt(b) ? a : b));
  const direction = params.after !== undefined ? 'after' : 'before';
  const cursor = direction === 'after' ? newest : oldest;
  const previous = params[direction];
  if (
    previous !== undefined &&
    /^\d+$/.test(previous) &&
    (direction === 'after'
      ? BigInt(cursor) <= BigInt(previous)
      : BigInt(cursor) >= BigInt(previous))
  ) {
    return '\n\n[Pagination blocked: the cursor did not advance. Stop and investigate; do not claim history is complete.]';
  }
  const next = JSON.stringify({
    platform: params.platform,
    channelId: params.channelId,
    [direction]: cursor,
    ...(params.limit !== undefined ? { limit: params.limit } : {}),
  });
  return `\n\n[Discord pagination: oldest message ID: "${oldest}"; newest message ID: "${newest}". Within the 3–5-call readMessages budget, to continue toward ${direction === 'before' ? 'older' : 'newer'} messages, call readMessages with ${next}. Use only one of before/after. More messages are unknown, regardless of page size; stop on a successful empty page, or stop and investigate errors/non-advancing cursors. For large-volume requests or tasks needing more calls, use the lobehub skill to batch read via the CLI (lh bot message read) outside the conversation context instead of repeatedly calling readMessages.]`;
};
