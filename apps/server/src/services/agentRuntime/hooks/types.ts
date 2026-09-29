/**
 * Agent Runtime Hooks — external lifecycle hook system
 *
 * Hook event types are defined in @lobechat/agent-runtime (shared).
 * Hook registration, webhook delivery, and serialization types are server-specific.
 */

import type { AgentHookEvent, AgentHookType, AnyHookEvent } from '@lobechat/agent-runtime';
import type {
  AgentHookMatcher,
  AgentHookWebhookConfig,
  SerializedAgentHook,
} from '@lobechat/types';

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

/** Outgoing projection, enriched with the final userId's available email. */
export type AgentHookWebhookPayload = Partial<AnyHookEvent> &
  Record<string, unknown> & { userEmail?: string };

/** Same schema and type in memory and persisted state, including fallback and header templates. */
export type AgentHookWebhook = AgentHookWebhookConfig;

type HookHandler = (event: AgentHookEvent) => Promise<void>;
export type NotificationWebhook = AgentHookWebhook & {
  onError?: 'continue';
  responseHandling?: 'ignore';
};

/** Control hooks are webhook-only and synchronous. Runtime support is gated by registration. */
export type AgentHook = {
  id: string;
  matcher?: AgentHookMatcher;
} & (
  | {
      handler?: never;
      type: 'beforeToolCall';
      webhook: AgentHookWebhook & { delivery?: 'fetch'; responseHandling: 'toolCall' };
    }
  | {
      handler: HookHandler;
      type: AgentHookType;
      webhook?: NotificationWebhook;
    }
  | {
      handler?: never;
      type: AgentHookType;
      webhook: NotificationWebhook;
    }
);

// ── Serialized Hook (for Redis persistence) ──────────────

/** Webhook-only configuration persisted on the operation; validated again before dispatch. */
export type SerializedHook = SerializedAgentHook;
