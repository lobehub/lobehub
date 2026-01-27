/* eslint-disable typescript-sort-keys/interface, sort-keys-fix/sort-keys-fix */
import type { ConversationContext } from '@lobechat/types';

/**
 * Operation Type Definitions
 * Unified operation state management for all async operations
 */

/**
 * Operation type enumeration - covers all async operations
 */
export type OperationType =
  // === Message sending ===
  | 'sendMessage' // Send message to server
  | 'createTopic' // Auto create topic
  | 'regenerate' // Regenerate message
  | 'continue' // Continue generation

  // === AI generation ===
  | 'execAgentRuntime' // Execute agent runtime (client-side, entire agent runtime execution)
  | 'execServerAgentRuntime' // Execute server agent runtime (server-side, e.g., Group Chat)
  | 'createAssistantMessage' // Create assistant message (sub-operation of execAgentRuntime)
  // === LLM execution (sub-operations) ===
  | 'callLLM' // Call LLM streaming response (sub-operation of execAgentRuntime)
  // === (sub-operations) ===
  | 'reasoning' // AI reasoning process (child operation)

  // === RAG and retrieval ===
  | 'rag' // RAG retrieval flow (child operation)
  | 'searchWorkflow' // Search workflow

  // === Tool calling ===
  | 'toolCalling' // Tool calling (streaming, child operation)
  // === (sub-operations) ===
  | 'createToolMessage' // Create tool message (sub-operation of executeToolCall)
  | 'executeToolCall' // Execute tool call (sub-operation of toolCalling)
  // === Tool intervention ===
  | 'approveToolCalling' // Approve tool intervention
  | 'rejectToolCalling' // Reject tool intervention
  // === (sub-operations of executeToolCall) ===
  | 'pluginApi' // Plugin API call
  | 'builtinToolSearch' // Builtin tool: search
  | 'builtinToolInterpreter' // Builtin tool: code interpreter
  | 'builtinToolLocalSystem' // Builtin tool: local system
  | 'builtinToolKnowledgeBase' // Builtin tool: knowledge base
  | 'builtinToolMemory' // Builtin tool: user memory
  | 'builtinToolAgentBuilder' // Builtin tool: agent builder
  | 'builtinToolGroupAgentBuilder' // Builtin tool: group agent builder
  | 'builtinToolPageAgent' // Builtin tool: page agent (document editing)

  // === Group Chat ===
  | 'supervisorDecision' // Supervisor decision
  | 'groupAgentGenerate' // Group agent generate (deprecated, use groupAgentStream)
  | 'groupAgentStream' // Group agent SSE stream (sub-operation of execServerAgentRuntime)

  // === Async Task (Desktop only) ===
  | 'execClientTask' // Execute single async sub-agent task on desktop client
  | 'execClientTasks' // Execute multiple async sub-agent tasks on desktop client

  // === Context Compression ===
  // Context compression (compress old messages into summary)
  | 'contextCompression'
  | 'createMessageGroup'
  | 'generateSummary'
  // === Others ===
  | 'translate'; // Translate message

/**
 * Operation status
 */
export type OperationStatus =
  | 'pending' // Waiting to start (not currently used)
  | 'running' // Executing
  | 'paused' // Paused (for user intervention scenarios)
  | 'completed' // Successfully completed
  | 'cancelled' // User cancelled
  | 'failed'; // Execution failed

/**
 * Operation context - business entity associations
 * Extends ConversationContext with operation-specific fields
 * Captured when Operation is created, never changes afterwards
 */
export interface OperationContext extends Partial<ConversationContext> {
  messageId?: string; // Associated message ID
  groupId?: string; // Associated group ID (Group Chat)
  agentId?: string; // Associated agent ID (specific agent in Group Chat)
}

/**
 * Operation cancel context - passed to cancel handler
 */
export interface OperationCancelContext {
  operationId: string;
  type: OperationType;
  reason: string;
  metadata?: OperationMetadata;
}

/**
 * Callback to execute after AgentRuntime completes
 */
export type AfterCompletionCallback = () => void | Promise<void>;

/**
 * Runtime hooks that can be registered during operation execution
 */
export interface RuntimeHooks {
  /**
   * Callbacks to execute after AgentRuntime completes
   * Used for actions that should happen after current execution finishes
   * to avoid race conditions with message updates
   */
  afterCompletionCallbacks?: AfterCompletionCallback[];
}

/**
 * Operation metadata
 */
export interface OperationMetadata {
  // Progress information
  progress?: {
    current: number;
    total: number;
    percentage?: number;
  };

  // Performance information
  startTime: number;
  endTime?: number;
  duration?: number;

  // Error information
  error?: {
    type: string;
    message: string;
    code?: string;
    details?: any;
  };

  // Cancel information
  cancelReason?: string;

  // UI state (for sendMessage operation)
  inputEditorTempState?: any | null; // Editor state snapshot for cancel restoration
  inputSendErrorMsg?: string; // Error message to display in UI

  // Runtime hooks (collected during execution, executed after completion)
  runtimeHooks?: RuntimeHooks;

  // Other metadata (extensible)
  [key: string]: any;
}

/**
 * Operation definition
 */
export interface Operation {
  // === Basic information ===
  id: string; // Unique operation ID (using nanoid)
  type: OperationType; // Operation type
  status: OperationStatus; // Operation status

  // === Context (core: capture and fix business context) ===
  context: OperationContext; // Associated entities, captured at creation

  // === Control ===
  abortController: AbortController; // Abort controller

  // === Metadata ===
  metadata: OperationMetadata;

  // === Cancel handler ===
  onCancelHandler?: (context: OperationCancelContext) => void | Promise<void>; // Cancel callback

  // === Dependencies ===
  parentOperationId?: string; // Parent operation ID (for operation nesting)
  childOperationIds?: string[]; // Child operation IDs

  // === UI display ===
  label?: string; // Operation display label (for UI)
  description?: string; // Operation description (for tooltip)
}

/**
 * Operation filter for querying operations
 */
export interface OperationFilter {
  type?: OperationType | OperationType[];
  status?: OperationStatus | OperationStatus[];
  agentId?: string;
  topicId?: string | null;
  messageId?: string;
  threadId?: string;
  groupId?: string;
}

// === Operation Type Constants ===

/**
 * Operation types that indicate AI is generating content
 * Used for loading state indicators and animation in UI
 *
 * Includes:
 * - execAgentRuntime: Client-side agent execution (single chat)
 * - execServerAgentRuntime: Server-side agent execution (Group Chat)
 */
export const AI_RUNTIME_OPERATION_TYPES: OperationType[] = [
  'execAgentRuntime',
  'execServerAgentRuntime',
];
