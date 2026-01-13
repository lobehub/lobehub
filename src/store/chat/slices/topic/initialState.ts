import { type ChatTopic } from '@/types/topic';

/**
 * Unified topic data structure for each agent
 */
export interface TopicData {
  currentPage: number;
  excludeTriggers?: string[];
  hasMore: boolean;
  isExpandingPageSize?: boolean;
  isLoadingMore?: boolean;
  items: ChatTopic[];
  /**
   * Last fetched/used page size for this topic container.
   * Used to detect "pageSize expansion" (user increases pageSize) without being affected by SWR revalidation
   * or cases where total items < pageSize.
   */
  pageSize: number;
  total: number;
}

export interface ChatTopicState {
  // TODO: need to add the null to the type
  activeTopicId?: string;
  /**
   * whether all topics drawer is open
   */
  allTopicsDrawerOpen: boolean;
  creatingTopic: boolean;
  inSearchingMode?: boolean;
  isSearchingTopic: boolean;
  searchTopics: ChatTopic[];
  /**
   * Unified topic data map for each agent
   * Contains items, total count, pagination state, and loading states
   */
  topicDataMap: Record<string, TopicData>;
  topicLoadingIds: string[];
  topicRenamingId?: string;
  topicSearchKeywords: string;
}

export const initialTopicState: ChatTopicState = {
  activeTopicId: null as any,
  allTopicsDrawerOpen: false,
  creatingTopic: false,
  isSearchingTopic: false,
  searchTopics: [],
  topicDataMap: {},
  topicLoadingIds: [],
  topicSearchKeywords: '',
};
