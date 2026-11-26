/**
 * `tasks.config.delivery`: the Channel (and optionally the Thread of it) where every run of the
 * task posts its final answer, text and cards, as the assignee Agent's message. Absent, results
 * only return to the creator's Topic. The run itself still works in its own Topic.
 *
 * Stored with `threadId: null` for the main timeline, so a later write that names no Thread
 * replaces an earlier Thread under the config's deep merge.
 */
export interface TaskChannelDelivery {
  channelId: string;
  threadId?: string | null;
}

/** What an Agent passes to set the delivery: `{}` means where it is answering now. */
export interface TaskChannelDeliveryInput {
  channelId?: string;
  threadId?: string;
}

const isId = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * The Channel delivery of a free-form task config, or undefined when there is none. `tasks.config`
 * is untyped jsonb, so a malformed entry reads as "no delivery", never as a broken post.
 */
export const readTaskChannelDelivery = (
  config: unknown,
): { channelId: string; threadId?: string } | undefined => {
  if (!config || typeof config !== 'object') return undefined;
  const raw = (config as Record<string, unknown>).delivery;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const { channelId, threadId } = raw as Record<string, unknown>;
  if (!isId(channelId)) return undefined;
  return { channelId, ...(isId(threadId) && { threadId }) };
};
