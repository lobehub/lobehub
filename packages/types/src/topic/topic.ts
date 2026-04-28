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

export type TopicGroupMode = 'byTime' | 'byProject' | 'flat';
export type TopicSortBy = 'createdAt' | 'updatedAt';

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

export interface ChatTopicBotContext {
  applicationId: string;
  platform: string;
  platformThreadId: string;
}

export interface OnboardingFeedbackEntry {
  comment?: string;
  rating: 'good' | 'bad';
  submittedAt: string;
}

export interface OnboardingSessionSnapshot {
  agentIdentityCompletedAt?: string;
  discoveryCompletedAt?: string;
  finalAgentNames?: string[];
  finishedAt?: string;
  lastActiveAt: string;
  phase: 'agent_identity' | 'user_identity' | 'discovery' | 'summary';
  startedAt: string;
  userIdentityCompletedAt?: string;
  version: number;
}

export interface ChatTopicMetadata {
  bot?: ChatTopicBotContext;
  boundDeviceId?: string;
  /**
   * Cron job ID that triggered this topic creation (if created by scheduled task)
   */
  cronJobId?: string;
  /**
   * Persistent session id for a heterogeneous agent (desktop only).
   * Saved after each turn so the next message in the same topic can resume
   * the conversation (e.g. Claude Code CLI uses `--resume <sessionId>`).
   * CC CLI stores sessions per-cwd under `~/.claude/projects/<encoded-cwd>/`,
   * so resume requires the current cwd to equal `workingDirectory`.
   */
  heteroSessionId?: string;
  model?: string;
  /**
   * Free-form feedback collected after agent onboarding completion.
   * Comment text is stored only here (not analytics) and is length-capped server-side.
   */
  onboardingFeedback?: OnboardingFeedbackEntry;
  onboardingSession?: OnboardingSessionSnapshot;
  provider?: string;
  /**
   * Currently running Gateway operation on this topic.
   * Set when agent execution starts, cleared when it completes/fails.
   * Used to reconnect WebSocket after page reload.
   */
  runningOperation?: {
    assistantMessageId: string;
    operationId: string;
    scope?: string;
    threadId?: string | null;
  } | null;
  userMemoryExtractRunState?: TopicUserMemoryExtractRunState;
  userMemoryExtractStatus?: 'pending' | 'completed' | 'failed';
  /**
   * Topic-level working directory (desktop only).
   * Priority is higher than Agent-level settings. Also serves as the
   * binding cwd for a CC session — written on first CC execution and
   * checked on subsequent turns to decide whether `--resume` is safe.
   */
  workingDirectory?: string;
}

export interface ChatTopicSummary {
  content: string;
  model: string;
  provider: string;
}

export type ChatTopicStatus = 'active' | 'completed' | 'archived';

export interface ChatTopic extends Omit<BaseDataModel, 'meta'> {
  completedAt?: Date | null;
  favorite?: boolean;
  historySummary?: string;
  metadata?: ChatTopicMetadata;
  sessionId?: string;
  status?: ChatTopicStatus | null;
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
  trigger?: string;
}

export interface QueryTopicParams {
  agentId?: string | null;
  current?: number;
  /**
   * Exclude topics by status (e.g. ['completed'])
   */
  excludeStatuses?: string[];
  /**
   * Exclude topics by trigger types (e.g. ['cron'])
   * Ignored when includeTriggers is provided.
   */
  excludeTriggers?: string[];
  /**
   * Group ID to filter topics by
   */
  groupId?: string | null;
  /**
   * Include only topics whose trigger matches one of these values.
   * Takes precedence over excludeTriggers when provided.
   */
  includeTriggers?: string[];
  /**
   * Whether this is an inbox agent query.
   * When true, also includes legacy inbox topics (sessionId IS NULL AND groupId IS NULL AND agentId IS NULL)
   */
  isInbox?: boolean;
  pageSize?: number;
  /**
   * Include only topics matching the given trigger types (positive filter)
   */
  triggers?: string[];
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
