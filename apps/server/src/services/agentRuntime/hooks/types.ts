/**
 * Agent Runtime Hooks — external lifecycle hook system
 *
 * Hook event types are defined in @lobechat/agent-runtime (shared).
 * Hook registration, webhook delivery, and serialization types are server-specific.
 */

import type { AgentHookEvent, AgentHookType } from '@lobechat/agent-runtime';

export type {
  AfterCallAgentHookEvent,
  AfterCompactHookEvent,
  AfterHumanInterventionHookEvent,
  AfterToolCallHookEvent,
  AgentHookEvent,
  AgentHookType,
  AnyHookEvent,
  BeforeCallAgentHookEvent,
  BeforeCompactHookEvent,
  BeforeHumanInterventionHookEvent,
  BeforeToolCallObservationEvent,
  CallAgentErrorHookEvent,
  CompactErrorHookEvent,
  StopByHumanInterventionHookEvent,
  ToolCallErrorHookEvent,
  ToolCallHookEvent,
} from '@lobechat/agent-runtime';

// ── Server-side Hook Types ───────────────────────────────

/**
 * Webhook delivery configuration for production mode
 */
export interface AgentHookWebhook {
  /** Custom data merged into webhook payload */
  body?: Record<string, unknown>;

  /** Delivery method: 'fetch' (plain HTTP) or 'qstash' (guaranteed delivery). Default: 'qstash' */
  delivery?: 'fetch' | 'qstash';

  /** Event fields to include in the webhook payload. Defaults to all serializable event fields. */
  eventFields?: (keyof AgentHookEvent)[];

  /**
   * Behavior when QStash delivery fails (publish error or missing
   * QSTASH_TOKEN). 'fetch' (default, legacy) retries as a plain unsigned
   * POST; 'none' throws instead. Use 'none' for endpoints behind QStash
   * signature auth — an unsigned fallback can never authenticate there, so
   * it only masks the delivery failure as a silently-dropped 401.
   */
  fallback?: 'fetch' | 'none';

  /** Webhook endpoint URL (relative or absolute) */
  url: string;
}

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
