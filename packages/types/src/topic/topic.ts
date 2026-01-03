import type { BaseDataModel } from '../meta';

// Type definitions
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
/* eslint-enable */

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
  model?: string;
  provider?: string;
  userMemoryExtractRunState?: TopicUserMemoryExtractRunState;
  userMemoryExtractStatus?: 'pending' | 'completed' | 'failed';
  /**
   * Local System 工作目录（桌面端专用）
   * 优先级高于 Agent 级别的设置
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
