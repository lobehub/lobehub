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
  /** Already-uploaded file IDs to attach to the user message */
  fileIds?: string[];
  /** Create a new thread along with execution */
  newThread?: {
    /** Parent thread ID for nested threads */
    parentThreadId?: string;
    /** Source message ID that spawned this thread */
    sourceMessageId: string;
    /** Thread title */
    title?: string;
    /** Thread type */
    type: string;
  };
  /** Create a new topic with additional options */
  newTopic?: {
    /** Existing message IDs to associate with the topic */
    topicMessageIds?: string[];
  };
  /** Page selections metadata to attach to the user message */
  pageSelections?: Array<{ content: string; title?: string; url?: string }>;
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
  /** The thread ID if a new thread was created */
  createdThreadId?: string;
  /** Error message if operation failed to start */
  error?: string;
  /** Whether a new topic was created */
  isCreateNewTopic?: boolean;
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
