import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';

type RuntimeType = 'gateway' | 'hetero';

/** A hetero event that already carries its result and asks for no refetch. */
const shouldSkipMessageFetch = (event: AgentStreamEvent, runtimeType: RuntimeType): boolean =>
  runtimeType === 'hetero' && event.data?.skipMessageFetch === true;

/**
 * Decides which gateway events still need a full-topic read (`getMessages`).
 * Every read returns the whole topic, so a read that a later event already
 * covers is skipped.
 */
export const createTopicRefreshGate = (runtimeType: RuntimeType) => {
  let revisionSeen = false;
  let latestToolEnd = 0;

  return {
    /**
     * A run whose server sends message revisions (`step_start.messageRevision`,
     * `message_patch`) settles without this read: the terminal step's patch
     * follows `execution_complete`, and `agent_runtime_end` refetches when its
     * revision is ahead of the last applied patch.
     */
    completionNeedsRefresh: (event: AgentStreamEvent) =>
      !revisionSeen && !shouldSkipMessageFetch(event, runtimeType),
    markRevisionSeen: () => {
      revisionSeen = true;
    },
    /**
     * Register a `tool_end` and return whether its queued read should still run
     * when its turn comes. Parallel tools of one step end in a burst: a read a
     * later `tool_end` supersedes is skipped, because that later read runs right
     * after it and returns a list at least as new.
     */
    toolEnd: (event: AgentStreamEvent): (() => boolean) => {
      if (shouldSkipMessageFetch(event, runtimeType)) return () => false;
      const ticket = ++latestToolEnd;
      return () => ticket === latestToolEnd;
    },
  };
};
