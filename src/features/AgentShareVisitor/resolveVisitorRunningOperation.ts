/** Sanitized `runningOperation` marker the visitor topic list carries — mirrors `VisitorRunningOperation` in `packages/database/src/models/topic.ts` (server projection) and the shape `useGatewayReconnect`'s `RunningOperation` needs. */
export interface VisitorTopicRunningOperation {
  assistantMessageId: string;
  heteroType?: string | null;
  operationId: string;
  scope?: string;
  threadId?: string | null;
}

interface VisitorTopicWithRunningOperation {
  id: string;
  runningOperation?: VisitorTopicRunningOperation | null;
}

/**
 * Finds the active topic in the visitor's topic list (from `useVisitorTopics`)
 * and returns its sanitized `runningOperation` marker, if any — what
 * `useGatewayReconnect` needs to resume a Gateway stream after a page reload.
 *
 * A pure lookup, kept separate from `VisitorConversation` so it can be
 * unit-tested without mounting the SWR-backed hook — same split as
 * `topicPanelViewState.ts`.
 */
export const resolveVisitorRunningOperation = (
  topics: VisitorTopicWithRunningOperation[] | undefined,
  topicId: string | null | undefined,
): VisitorTopicRunningOperation | undefined => {
  if (!topicId) return undefined;

  return topics?.find((topic) => topic.id === topicId)?.runningOperation ?? undefined;
};
