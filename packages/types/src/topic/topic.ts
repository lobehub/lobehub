import type { BaseDataModel } from '../meta';

// Type definitions
export type ShareVisibility = 'private' | 'link';

export type TimeGroupId =
  | 'today'
  | 'yesterday'
  | 'week'
  | 'month'
  | `${number}-${string}`
  | `${number}`;

/* eslint-disable typescript-sort-keys/string-enum */
export enum TopicDisplayMode {
  ByTime = 'byTime',
  Flat = 'flat',
  // AscMessages = 'ascMessages',
  // DescMessages = 'descMessages',
}

export interface GroupedTopic {
  children: ChatTopic[];
  id: string;
  title?: string;
}

export interface TopicUserMemoryExtractRunState {
  error?: string;
  lastMessageAt?: string;
  lastRunAt?: string;
  messageCount?: number;
  processedMemoryCount?: number;
  traceId?: string;
}

export interface ChatTopicMetadata {
  /**
   * Cron job ID that triggered this topic creation (if created by scheduled task)
   */
  cronJobId?: string;
  model?: string;
  provider?: string;
  userMemoryExtractRunState?: TopicUserMemoryExtractRunState;
  userMemoryExtractStatus?: 'pending' | 'completed' | 'failed';
  /**
   * Local System working directory (desktop only)
   * Priority is higher than Agent-level settings
   */
  workingDirectory?: string;
}

export interface ChatTopicSummary {
  content: string;
  model: string;
  provider: string;
}

export interface ChatTopic extends Omit<BaseDataModel, 'meta'> {
  favorite?: boolean;
  historySummary?: string;
  metadata?: ChatTopicMetadata;
  sessionId?: string;
  title: string;
  trigger?: string | null;
}

export type ChatTopicMap = Record<string, ChatTopic>;

export interface TopicRankItem {
  count: number;
  id: string;
  sessionId: string | null;
  title: string | null;
}

export interface RecentTopicAgent {
  avatar: string | null;
  backgroundColor: string | null;
  id: string;
  title: string | null;
}

export interface RecentTopicGroupMember {
  avatar: string | null;
  backgroundColor: string | null;
}

export interface RecentTopicGroup {
  id: string;
  members: RecentTopicGroupMember[];
  title: string | null;
}

export interface RecentTopic {
  agent: RecentTopicAgent | null;
  group: RecentTopicGroup | null;
  id: string;
  title: string | null;
  type: 'agent' | 'group';
  updatedAt: Date;
}

export interface CreateTopicParams {
  favorite?: boolean;
  groupId?: string | null;
  messages?: string[];
  sessionId?: string | null;
  title: string;
}

export interface QueryTopicParams {
  agentId?: string | null;
  current?: number;
  /**
   * Exclude topics by trigger types (e.g. ['cron'])
   */
  excludeTriggers?: string[];
  /**
   * Group ID to filter topics by
   */
  groupId?: string | null;
  /**
   * Whether this is an inbox agent query.
   * When true, also includes legacy inbox topics (sessionId IS NULL AND groupId IS NULL AND agentId IS NULL)
   */
  isInbox?: boolean;
  pageSize?: number;
}

/**
 * Shared message data for public sharing
 */
export interface SharedMessage {
  content: string;
  createdAt: Date;
  id: string;
  role: string;
}

/**
 * Shared topic data returned by public API
 */
export interface SharedTopicData {
  agentId: string | null;
  agentMeta?: {
    avatar?: string | null;
    backgroundColor?: string | null;
    marketIdentifier?: string | null;
    slug?: string | null;
    title?: string | null;
  };
  groupId: string | null;
  groupMeta?: {
    avatar?: string | null;
    backgroundColor?: string | null;
    createdAt?: Date | null;
    members?: {
      avatar: string | null;
      backgroundColor: string | null;
      id: string;
      title: string | null;
    }[];
    title?: string | null;
    updatedAt?: Date | null;
    userId?: string | null;
  };
  shareId: string;
  title: string | null;
  topicId: string;
  visibility: ShareVisibility;
}

/**
 * Topic share info returned to the owner
 */
export interface TopicShareInfo {
  id: string;
  topicId: string;
  visibility: ShareVisibility;
}
