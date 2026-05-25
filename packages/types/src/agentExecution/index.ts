import type { TaskDetail, UIChatMessage } from '../message';
import type { ChatTopic } from '../topic';

/**
 * Application context for message storage
 */
export interface ExecAgentAppContext {
  /** Optional default assignee candidate for task manager prompts */
  defaultTaskAssigneeAgentId?: string;
  /** Current document ID for page-scoped conversations */
  documentId?: string | null;
  /** Group ID for group chat */
  groupId?: string | null;
  /**
   * Initial metadata to merge into the topic when a new topic is created for
   * this execution. Ignored when a topicId is already provided (existing topic).
   */
  initialTopicMetadata?: {
    repos?: string[];
    workingDirectory?: string;
  };
  /** Scope identifier */
  scope?: string | null;
  /** Session ID */
  sessionId?: string;
  /** Optional assistant message id that anchors the run (e.g. parent for an isolated thread). */
  sourceMessageId?: string;
  /**
   * Suppresses AgentSignal `agent.user.message` re-emission when this run is itself driven by a
   * background/builtin agent. Required for self-iteration / memory-writer / skill-manager runs to
   * avoid recursion into the analyzeIntent pipeline.
   */
  suppressSignal?: boolean;
  /** Current task identifier when executing from a task detail surface */
  taskId?: string | null;
  /** Thread ID for threaded conversations */
  threadId?: string | null;
  /** Topic ID */
  topicId?: string | null;
}

/**
 * A project-level skill discovered on the device filesystem
 * (`.agents/skills` / `.claude/skills`) by the client at request time.
 * Only frontmatter + the absolute SKILL.md path are carried; the SKILL.md
 * body and directory tree are loaded on demand at activation time via the
 * readFile / listFiles tools.
 */
export interface ProjectSkillMeta {
  /** Skill description from SKILL.md frontmatter. */
  description?: string;
  /** Skill name from frontmatter (falls back to the directory name). */
  name: string;
  /** Absolute path to the skill's SKILL.md on the device filesystem. */
  path: string;
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
  /** Explicit device ID to bind to the topic and activate for this run */
  deviceId?: string;
  /** Optional existing message IDs to include in context */
  existingMessageIds?: string[];
  /**
   * File IDs of already-uploaded attachments to attach to the new user message.
   * Resolved server-side via FileModel.findByIds into imageList / videoList / fileList.
   * Use this when files were uploaded separately via the file upload flow
   * (e.g. SPA Gateway mode). For platform-adapter ingestion from raw URL/buffer,
   * use the internal `files` param instead.
   */
  fileIds?: string[];
  /** Additional system instructions appended after the agent's own system role */
  instructions?: string;
  /** Override the agent's default model */
  model?: string;
  /**
   * Parent operation ID when this run is a sub-agent invocation. Forwarded
   * to `agent_operations.parent_operation_id` so analytics can join the
   * sub-tree back to its root.
   */
  parentOperationId?: string;
  /**
   * Project-level skills discovered on the device filesystem
   * (`.agents/skills` / `.claude/skills`) at request time. Surfaced in the
   * `<available_skills>` list and loaded on demand via the readFile tool.
   * Only applied when a device is active for this run.
   */
  projectSkills?: ProjectSkillMeta[];
  /** The user input/prompt */
  prompt: string;
  /** Override the agent's default provider */
  provider?: string;
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
  /** Short-lived JWT token for Gateway WebSocket authentication */
  token?: string;
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
  /** Operation ID for tracking execution status */
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
  /** Parent operation ID for dispatching callAgent hooks */
  parentOperationId?: string;
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
