/**
 * Agent Runtime Hooks — external lifecycle hook system
 *
 * Hook event types are defined in @lobechat/agent-runtime (shared).
 * Hook registration, webhook delivery, and serialization types are server-specific.
 */

import type { AgentHookEvent, AgentHookType } from '@lobechat/agent-runtime';
import type { AgentHookWebhookConfig, SerializedAgentHook } from '@lobechat/types';

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
 * Webhook delivery configuration for production mode.
 *
 * Runtime-precise refinement of the serialized wire shape
 * ({@link AgentHookWebhookConfig} in `@lobechat/types`, used for persistence /
 * zod validation): the shared `body` / `delivery` / `url` are inherited, while
 * `eventFields` is narrowed to `keyof AgentHookEvent` and the server-only
 * `fallback` policy is added.
 */
export interface AgentHookWebhook extends Omit<AgentHookWebhookConfig, 'eventFields'> {
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
 * Serialized hook config stored in AgentState.metadata._hooks (and on
 * `topic.metadata.runningOperation.hooks`). Only contains webhook info —
 * handler functions can't be serialized.
 *
 * Runtime-precise refinement of the wire shape ({@link SerializedAgentHook} in
 * `@lobechat/types`): `type` is narrowed to `AgentHookType` and `webhook` to
 * {@link AgentHookWebhook}. A persisted hook read back off topic metadata casts
 * up to this.
 */
export interface SerializedHook extends Omit<SerializedAgentHook, 'type' | 'webhook'> {
  type: AgentHookType;
  webhook: AgentHookWebhook;
}
