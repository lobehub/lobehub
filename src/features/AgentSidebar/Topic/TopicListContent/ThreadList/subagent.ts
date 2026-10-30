import type { ThreadMetadata } from '@lobechat/types';

/**
 * Whether a thread was spawned by a tool call — the product's own subagent
 * marker (see `threadSelectors.isActiveThreadSubagent` and `Portal/Thread/Chat`).
 *
 * A direct `@Agent` mention creates an isolation thread *without* it, and that
 * thread is an ordinary target-agent conversation the user can keep chatting
 * in, so keying on `ThreadType.Isolation` alone would label it a subagent.
 * A thread attributed to a subagent preset (`subagentId`) is always one.
 */
export const isSubagentThread = (thread: {
  metadata?: null | ThreadMetadata;
  subagentId?: null | string;
}): boolean => Boolean(thread.subagentId || thread.metadata?.sourceToolCallId);
