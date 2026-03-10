import { z } from 'zod';

import type { AgentItem } from '../agent';
import type { TaskDetail, UIChatMessage } from '../message';
import type { ChatTopic } from '../topic';

export interface LobeChatGroupMetaConfig {
  avatar?: string;
  backgroundColor?: string;
  description: string;
  marketIdentifier?: string;
  title: string;
}

export interface LobeChatGroupChatConfig {
  allowDM?: boolean;
  forkedFromIdentifier?: string;
  openingMessage?: string;
  openingQuestions?: string[];
  revealDM?: boolean;
  systemPrompt?: string;
}

// Database config type (flat structure)
export type LobeChatGroupConfig = LobeChatGroupChatConfig;

// Zod schema for ChatGroupConfig (database insert)
export const ChatGroupConfigSchema = z.object({
  allowDM: z.boolean().optional(),
  forkedFromIdentifier: z.string().optional(),
  openingMessage: z.string().optional(),
  openingQuestions: z.array(z.string()).optional(),
  revealDM: z.boolean().optional(),
  systemPrompt: z.string().optional(),
});

// Zod schema for inserting ChatGroup
export const InsertChatGroupSchema = z.object({
  avatar: z.string().optional().nullable(),
  backgroundColor: z.string().optional().nullable(),
  clientId: z.string().optional().nullable(),
  config: ChatGroupConfigSchema.optional().nullable(),
  content: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  editorData: z.record(z.string(), z.any()).optional().nullable(),
  groupId: z.string().optional().nullable(),
  id: z.string().optional(),
  marketIdentifier: z.string().optional().nullable(),
  pinned: z.boolean().optional().nullable(),
  title: z.string().optional().nullable(),
});

export type InsertChatGroup = z.infer<typeof InsertChatGroupSchema>;

// Full group type with nested structure for UI components
export interface LobeChatGroupFullConfig {
  chat: LobeChatGroupChatConfig;
  meta: LobeChatGroupMetaConfig;
}

// Chat Group Agent types (independent from schema)
export interface ChatGroupAgent {
  agentId: string;
  chatGroupId: string;
  createdAt: Date;
  enabled?: boolean;
  order?: number;
  role?: string;
  updatedAt: Date;
  userId: string;
}

export interface NewChatGroupAgent {
  agentId: string;
  chatGroupId: string;
  enabled?: boolean;
  order?: number;
  role?: string;
  userId: string;
}

// New Chat Group type for creating groups (independent from schema)
export interface NewChatGroup {
  avatar?: string | null;
  backgroundColor?: string | null;
  clientId?: string | null;
  config?: LobeChatGroupConfig | null;
  description?: string | null;
  groupId?: string | null;
  id?: string;
  marketIdentifier?: string | null;
  pinned?: boolean | null;
  title?: string | null;
  userId: string;
}

// Chat Group Item type (independent from schema)
export interface ChatGroupItem {
  accessedAt?: Date;
  avatar?: string | null;
  backgroundColor?: string | null;
  clientId?: string | null;
  config?: LobeChatGroupConfig | null;
  content?: string | null;
  createdAt: Date;
  description?: string | null;
  editorData?: Record<string, any> | null;
  groupId?: string | null;
  id: string;
  marketIdentifier?: string | null;
  pinned?: boolean | null;
  title?: string | null;
  updatedAt: Date;
  userId: string;
}

// Agent item with group role info
export type AgentGroupMember = AgentItem & {
  /**
   * Whether this agent is the supervisor of the group
   */
  isSupervisor: boolean;
};

// Agent Group Detail - extends ChatGroupItem with agents
export interface AgentGroupDetail extends ChatGroupItem {
  agents: AgentGroupMember[];
  /**
   * The supervisor agent ID, if exists
   */
  supervisorAgentId?: string;
}

// ============ Agent Execution Types ============

/**
 * Application context for message storage
 */
export interface ExecAgentAppContext {
  /** Group ID for group chat */
  groupId?: string | null;
  /** Scope identifier */
  scope?: string | null;
  /** Session ID */
  sessionId?: string;
  /** Thread ID for threaded conversations */
  threadId?: string | null;
  /** Topic ID */
  topicId?: string | null;
}

/**
 * Parameters for execAgent - execute a single Agent
 * Either agentId or slug must be provided
 */
export interface ExecAgentParams {
  /** The agent ID to run (either agentId or slug is required) */
  agentId?: string;
  /** Application context for message storage */
  appContext?: ExecAgentAppContext;
  /** Whether to auto-start execution after creating operation (default: true) */
  autoStart?: boolean;
  /** Optional existing message IDs to include in context */
  existingMessageIds?: string[];
  /** The user input/prompt */
  prompt: string;
  /** The agent slug to run (either agentId or slug is required) */
  slug?: string;
}

/**
 * Response from execAgent
 */
export interface ExecAgentResult {
  /** The resolved agent ID */
  agentId: string;
  /** The assistant message ID created for this operation */
  assistantMessageId: string;
  /** Whether the operation was auto-started */
  autoStarted: boolean;
  /** Timestamp when operation was created */
  createdAt: string;
  /** Error message if operation failed to start */
  error?: string;
  /** Status message */
  message: string;
  /** Queue message ID if auto-started */
  messageId?: string;
  /** Operation ID for SSE connection */
  operationId: string;
  /** Operation status */
  status: string;
  /** Whether the operation was created successfully */
  success: boolean;
  /** ISO timestamp */
  timestamp: string;
  /** The topic ID (created or reused) */
  topicId: string;
  /** The user message ID created for this operation */
  userMessageId: string;
}

// ============ Group Agent Execution Types ============

/**
 * Options for creating a new topic in group chat
 */
export interface ExecGroupAgentNewTopicOptions {
  /** Topic title */
  title?: string;
  /** Message IDs to include in the topic */
  topicMessageIds?: string[];
}

/**
 * Parameters for execGroupAgent - execute Supervisor Agent in Group chat
 */
export interface ExecGroupAgentParams {
  /** The Supervisor agent ID */
  agentId: string;
  /** File IDs attached to the message */
  files?: string[];
  /** The Group ID */
  groupId: string;
  /** User message content */
  message: string;
  /** Optional: Create a new topic */
  newTopic?: ExecGroupAgentNewTopicOptions;
  /** Existing topic ID */
  topicId?: string | null;
}

/**
 * Result from execGroupAgent (internal, without messages/topics)
 */
export interface ExecGroupAgentResult {
  /** The assistant message ID created for this operation */
  assistantMessageId: string;
  /** Error message if operation failed to start */
  error?: string;
  /** Whether a new topic was created */
  isCreateNewTopic: boolean;
  /** Operation ID for SSE connection */
  operationId: string;
  /** Whether the operation was created successfully */
  success?: boolean;
  /** The topic ID */
  topicId: string;
  /** The user message ID created for this operation */
  userMessageId: string;
}

/**
 * Response from execGroupAgent (with messages/topics for UI sync)
 */
export interface ExecGroupAgentResponse {
  /** The assistant message ID created for this operation */
  assistantMessageId: string;
  /** Error message if operation failed to start */
  error?: string;
  /** Whether a new topic was created */
  isCreateNewTopic: boolean;
  /** Latest messages in the conversation */
  messages: UIChatMessage[];
  /** Operation ID for SSE connection */
  operationId: string;
  /** Whether the operation was created successfully */
  success?: boolean;
  /** The topic ID */
  topicId: string;
  /** Topics list (if new topic was created) */
  topics?: {
    items: ChatTopic[];
    total: number;
  };
  /** The user message ID created for this operation */
  userMessageId: string;
}

// ============ SubAgent Task Execution Types ============

/**
 * Parameters for execSubAgentTask - execute SubAgent task
 * Supports both Group mode and Single Agent mode
 *
 * - Group mode: pass groupId, Thread will be associated with the Group
 * - Single Agent mode: omit groupId, Thread will only be associated with the Agent
 */
export interface ExecSubAgentTaskParams {
  /** The SubAgent ID to execute the task */
  agentId: string;
  /** The Group ID (optional, only for Group mode) */
  groupId?: string;
  /** Task instruction/prompt for the SubAgent */
  instruction: string;
  /** The parent message ID (Supervisor's tool call message or task message) */
  parentMessageId: string;
  /** Timeout in milliseconds (optional) */
  timeout?: number;
  /** Task title (shown in UI, used as thread title) */
  title?: string;
  /** The Topic ID */
  topicId: string;
}

/**
 * Result from execSubAgentTask
 */
export interface ExecSubAgentTaskResult {
  /** The assistant message ID created for this task */
  assistantMessageId: string;
  /** Error message if task failed to start */
  error?: string;
  /** Operation ID for tracking execution status */
  operationId: string;
  /** Whether the task was created successfully */
  success: boolean;
  /** The Thread ID where the task is executed */
  threadId: string;
}

/**
 * @deprecated Use ExecSubAgentTaskParams instead
 */
export type ExecGroupSubAgentTaskParams = ExecSubAgentTaskParams;

/**
 * @deprecated Use ExecSubAgentTaskResult instead
 */
export type ExecGroupSubAgentTaskResult = ExecSubAgentTaskResult;

/**
 * Current activity for real-time progress display
 * Only returned when task is processing
 */
export interface TaskCurrentActivity {
  /** API name, e.g. "search" */
  apiName?: string;
  /** Content preview (truncated) */
  contentPreview?: string;
  /** Plugin identifier, e.g. "lobe-web-browsing" */
  identifier?: string;
  /** Activity type */
  type: 'tool_calling' | 'tool_result' | 'generating';
}

/**
 * Task status query result
 */
export interface TaskStatusResult {
  /** Task completion time (ISO string) */
  completedAt?: string;
  /** Cost information */
  cost?: { total: number };
  /** Current activity for real-time progress display (only when processing) */
  currentActivity?: TaskCurrentActivity;
  /** Error message if task failed */
  error?: string;
  /**
   * Parsed UI messages from conversation-flow
   * Used for displaying intermediate steps in server task
   */
  messages?: UIChatMessage[];
  /** Task result content (last assistant message) */
  result?: string;
  /** Current task status */
  status: 'processing' | 'completed' | 'failed' | 'cancel';
  /** Number of steps executed */
  stepCount?: number;
  /** Task detail from Thread table */
  taskDetail?: TaskDetail;
  /** Model usage information */
  usage?: {
    completion_tokens?: number;
    prompt_tokens?: number;
    total_tokens?: number;
  };
}
