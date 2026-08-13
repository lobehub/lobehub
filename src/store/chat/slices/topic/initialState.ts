export interface TopicLoadMoreState {
  isLoadingMore?: boolean;
  loadMoreError?: unknown;
}

export interface ChatTopicState {
  // TODO: need to add the null to the type
  activeTopicId?: string;
  agentTopicsLoadMoreStateMap: Record<string, TopicLoadMoreState>;
  /**
   * whether all topics drawer is open
   */
  allTopicsDrawerOpen: boolean;
  creatingTopic: boolean;
  /**
   * Ids of client-minted topics whose server row does not exist yet (the
   * first-send window between minting the id and the server confirming the
   * topic). State rather than a private field because consumers must react to
   * it: `#reconcileFetchedTopics` keeps these rows across refetches, and the
   * message-fetch gate skips fetching a topic that cannot return rows yet —
   * an early fetch would come back empty and wipe the optimistic messages.
   *
   * Registered on an `optimistic` addTopic dispatch; cleared by
   * `replaceTopicId` (server confirmed) or `deleteTopic` (rollback).
   */
  creatingTopicIds: string[];
  inSearchingMode?: boolean;
  topicLoadMoreStateMap: Record<string, TopicLoadMoreState>;
  topicRenamingId?: string;
  topicSearchKeywords: string;
}

export const initialTopicState: ChatTopicState = {
  activeTopicId: null as any,
  agentTopicsLoadMoreStateMap: {},
  creatingTopicIds: [],
  allTopicsDrawerOpen: false,
  creatingTopic: false,
  topicLoadMoreStateMap: {},
  topicSearchKeywords: '',
};
