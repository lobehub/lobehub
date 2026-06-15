import type { TaskDetail, UIChatMessage } from '../message';
import type { ChatTopic } from '../topic';

export type AgentSignalOperationKind =
  | 'memory'
  | 'nightly-review'
  | 'self-feedback-intent'
  | 'self-reflection'
  | 'skill';

/**
 * Run-scoped Agent Signal marker stamped onto a background agent operation at
 * dispatch. It travels on `appContext.agentSignal`, lands in
 * `state.metadata.agentSignal`, and is read back on the completion path to
 * project receipts / briefs (the `agent.execution.completed` payload itself only
 * carries `agentId/operationId/topicId`). Runtime parsing/validation helpers live
 * server-side in `operationMarker.ts`.
 */
export interface AgentSignalOperationMarker {
  /**
   * The reviewed user agent a resulting receipt should be attributed to. Needed
   * when the run executes under a builtin self-iteration slug (whose resolved
   * operation agentId is the builtin agent, not the user's agent); the
   * completion projector prefers this over the run's agentId.
   */
  agentId?: string;
  /** Assistant message a resulting receipt should anchor to. */
  anchorMessageId?: string;
  /** Discriminator the completion handler dispatches on. */
  kind: AgentSignalOperationKind;
  /** Local review date (YYYY-MM-DD) for nightly review brief/receipt writes. */
  localDate?: string;
  /** Review window end (ISO) — lets tools re-derive the evidence digest. */
  reviewWindowEnd?: string;
  /** Review window start (ISO). */
  reviewWindowStart?: string;
  /** Stable producer source id of the originating signal. */
  sourceId?: string;
  /** Topic the run is scoped to. */
  topicId?: string;
  /** User message that initiated the originating feedback. */
  triggerMessageId?: string;
}

/**
 * Application context for message storage
 */
export interface ExecAgentAppContext {
  /**
   * Agent document row id (`agent_documents.id`) for the document the user is
   * currently viewing. When supplied, the active document context is built
   * directly without a `listDocumentsForTopic` reverse lookup, so docs opened
   * outside the active topic (skills, web docs) still carry `agent_document_id`
   * for downstream tool calls.
   */
  agentDocumentId?: string | null;
  /**
   * Run-scoped Agent Signal marker for background self-iteration / memory runs.
   * Forwarded into the operation so the completion path can project receipts.
   */
  agentSignal?: AgentSignalOperationMarker;
  /** Optional default assignee candidate for task manager prompts */
  defaultTaskAssigneeAgentId?: string;
  /** Current document ID for page-scoped conversations */
  documentId?: string | null;
  /**
   * When scope is 'agent_builder', the ID of the agent being edited (i.e. the
   * left-sidebar agent the user opened AgentBuilder for). The AgentBuilder
   * builtin runs under its own `agentId`; this field carries the *target* so
   * server-side tool executors update the correct agent rather than the builder
   * itself.
   */
  editingAgentId?: string;
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
  /**
   * Whether this operation is an isolated sub-agent execution. Used to disable
   * recursive sub-agent dispatch.
   */
  isSubAgent?: boolean;
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

// ============ SubAgent Execution Types ============

/**
 * Parameters for execSubAgent - execute an agent in an isolated thread
 * Supports both Group mode and Single Agent mode
 *
 * - Group mode: pass groupId, Thread will be associated with the Group
 * - Single Agent mode: omit groupId, Thread will only be associated with the Agent
 */
export interface ExecSubAgentParams {
  /** The agent ID to execute */
  agentId: string;
  /** The Group ID (optional, only for Group mode) */
  groupId?: string;
  /** Instruction/prompt for the agent */
  instruction: string;
  /** The parent message ID that anchors the isolated thread */
  parentMessageId: string;
  /** Parent operation ID for dispatching callAgent hooks */
  parentOperationId?: string;
  /** Timeout in milliseconds (optional) */
  timeout?: number;
  /** Thread title shown in UI */
  title?: string;
  /** The Topic ID */
  topicId: string;
}

/**
 * Parameters for execVirtualSubAgent - execute a `lobe-agent.callSubAgent`
 * child run.
 *
 * Virtual sub-agents are tool-created isolated runs. They are marked with
 * `appContext.isSubAgent` so the child cannot recursively spawn more
 * sub-agents, and they install the completion bridge that backfills the
 * parent's placeholder tool message before resuming the parent operation.
 */
export interface ExecVirtualSubAgentParams {
  /** The agent ID to execute */
  agentId: string;
  /** The Group ID inherited from the parent operation, when present */
  groupId?: string;
  /** Instruction/prompt for the virtual sub-agent */
  instruction: string;
  /** The parent placeholder tool message ID */
  parentMessageId: string;
  /** Parent operation ID to bridge and resume on completion */
  parentOperationId: string;
  /** Timeout in milliseconds (optional) */
  timeout?: number;
  /** Thread title shown in UI */
  title?: string;
  /** The Topic ID */
  topicId: string;
}

/**
 * Result from execSubAgent
 */
export interface ExecSubAgentResult {
  /** The assistant message ID created for this run */
  assistantMessageId: string;
  /** Error message if execution failed to start */
  error?: string;
  /** Operation ID for tracking execution status */
  operationId: string;
  /** Whether the execution was created successfully */
  success: boolean;
  /** The Thread ID where the execution is isolated */
  threadId: string;
}

/**
 * @deprecated Use ExecSubAgentParams instead
 */
export type ExecGroupSubAgentTaskParams = ExecSubAgentParams;

/**
 * @deprecated Use ExecSubAgentResult instead
 */
export type ExecGroupSubAgentTaskResult = ExecSubAgentResult;

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
