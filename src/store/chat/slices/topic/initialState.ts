import { type ChatTopic } from '@/types/topic';

/**
 * Unified topic data structure for each agent
 */
export interface TopicData {
  currentPage: number;
  excludeStatuses?: string[];
  excludeTriggers?: string[];
  hasMore: boolean;
  isExpandingPageSize?: boolean;
  isInbox?: boolean;
  isLoadingMore?: boolean;
  items: ChatTopic[];
  /**
   * Last page-fetch failure. Kept separate from the first-page SWR `error` so
   * infinite-scroll surfaces can render an inline Retry row instead of silently
   * dropping the loading-more row while `hasMore` remains true.
   */
  loadMoreError?: unknown;
  /**
   * Last fetched/used page size for this topic container.
   * Used to detect "pageSize expansion" (user increases pageSize) without being affected by SWR revalidation
   * or cases where total items < pageSize.
   */
  pageSize: number;
  total: number;
  /**
   * Tracks whether the first fetch for this container asked the server for
   * the heavier card-detail columns. `loadMoreTopics` reads it back so
   * subsequent pages stay shape-consistent with the initial fetch.
   */
  withDetails?: boolean;
}

export interface ChatTopicState {
  // TODO: need to add the null to the type
  activeTopicId?: string;
  /**
   * Topic data map dedicated to the Agent Topics management page
   * (`/agent/:aid/topics`). Kept separate from `topicDataMap` because the page
   * fetches with `withDetails: true` and a larger page size, and otherwise it
   * would share a bucket with the sidebar's cheap fetch — whichever response
   * lands last wins, tangling both views.
   */
  agentTopicsViewMap: Record<string, TopicData>;
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
  isSearchingTopic: boolean;
  searchTopics: ChatTopic[];
  /**
   * Unified topic data map for each agent
   * Contains items, total count, pagination state, and loading states
   */
  topicDataMap: Record<string, TopicData>;
  /**
   * Per-id topic detail cache, filled by `useFetchTopicDetail` when the active
   * topic is missing from the loaded list bucket — e.g. an archived
   * (`completed`) topic that the sidebar fetch excludes via `excludeStatuses`.
   * `currentActiveTopic` / `getTopicById` read it as a fallback so the header
   * keeps the real title instead of degrading to the "new topic" placeholder.
   */
  topicDetailMap: Record<string, ChatTopic>;
  /**
   * Internal ref-count for topic loading owners. A topic can be loading because
   * the agent is running and because title-summary is streaming at the same time.
   */
  topicLoadingIdCounts: Record<string, number>;
  topicLoadingIds: string[];
  topicRenamingId?: string;
  topicSearchKeywords: string;
}

export const initialTopicState: ChatTopicState = {
  activeTopicId: null as any,
  agentTopicsViewMap: {},
  creatingTopicIds: [],
  allTopicsDrawerOpen: false,
  creatingTopic: false,
  isSearchingTopic: false,
  searchTopics: [],
  topicDataMap: {},
  topicDetailMap: {},
  topicLoadingIdCounts: {},
  topicLoadingIds: [],
  topicSearchKeywords: '',
};
