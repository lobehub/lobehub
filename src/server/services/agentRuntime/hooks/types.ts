/**
 * Agent Runtime Hooks — external lifecycle hook system
 *
 * Hooks are registered once and automatically adapt to the runtime mode:
 * - Local mode: handler function is called directly (in-process)
 * - Production (QStash) mode: webhook is delivered via HTTP POST
 */

// ── Hook Types ──────────────────────────────────────────

/**
 * Lifecycle hook points in agent execution
 */
export type AgentHookType =
  | 'afterStep' // After each step completes
  | 'beforeStep' // Before each step executes
  | 'onComplete' // Operation reaches terminal state (done/error/interrupted)
  | 'onError'; // Error during execution

/**
 * Hook definition — consumers register these with execAgent
 */
export interface AgentHook {
  /** Handler function for local mode (called in-process) */
  handler: (event: AgentHookEvent) => Promise<void>;

  /** Unique hook identifier (for logging, debugging, idempotency) */
  id: string;

  /** Hook lifecycle point */
  type: AgentHookType;

  /** Webhook config for production mode (if omitted, hook only works in local mode) */
  webhook?: AgentHookWebhook;
}

/**
 * Webhook delivery configuration for production mode
 */
export interface AgentHookWebhook {
  /** Custom data merged into webhook payload */
  body?: Record<string, unknown>;

  /** Delivery method: 'fetch' (plain HTTP) or 'qstash' (guaranteed delivery). Default: 'qstash' */
  delivery?: 'fetch' | 'qstash';

  /** Webhook endpoint URL (relative or absolute) */
  url: string;
}

// ── Hook Events ──────────────────────────────────────────

/**
 * Unified event payload passed to hook handlers and webhook payloads
 */
export interface AgentHookEvent {
  // Identification
  agentId: string;
  // Statistics
  cost?: number;
  duration?: number;
  // Content
  errorDetail?: string;

  errorMessage?: string;

  /**
   * Full AgentState — only available in local mode.
   * Not serialized to webhook payloads.
   * Use for consumers that need deep state access (e.g., SubAgent Thread updates).
   */
  finalState?: any;
  lastAssistantContent?: string;

  llmCalls?: number;
  // Caller-provided metadata (from webhook.body)
  metadata?: Record<string, unknown>;
  operationId: string;
  // Execution result
  reason?: string; // 'done' | 'error' | 'interrupted' | 'max_steps' | 'cost_limit'
  // Step-specific (for beforeStep/afterStep)
  shouldContinue?: boolean;
  status?: string; // 'done' | 'error' | 'interrupted' | 'waiting_for_human'

  stepIndex?: number;
  steps?: number;
  stepType?: string; // 'call_llm' | 'call_tool'

  toolCalls?: number;
  topicId?: string;
  totalTokens?: number;

  userId: string;
}

// ── Serialized Hook (for Redis persistence) ──────────────

/**
 * Serialized hook config stored in AgentState.metadata._hooks
 * Only contains webhook info (handler functions can't be serialized)
 */
export interface SerializedHook {
  id: string;
  type: AgentHookType;
  webhook: AgentHookWebhook;
}
