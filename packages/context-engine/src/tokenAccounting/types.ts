import type { UIChatMessage } from '@lobechat/types';

/**
 * Source category each token belongs to.
 *
 * - `content`           — `msg.content` (the text body sent to provider)
 * - `toolCalls`         — assistant's tool call payloads (`msg.tools[]`, equivalent
 *                         to OpenAI `tool_calls` once transformed): `id`, `apiName`,
 *                         `arguments`, `type` are sent to provider
 * - `thoughtSignature`  — Gemini-specific opaque signature attached to each tool
 *                         call (`msg.tools[N].thoughtSignature`); preserved by
 *                         `ToolCallProcessor` and forwarded to Google's API; can
 *                         be sizeable on every function call
 * - `reasoning`         — thinking-mode trace (`msg.reasoning.content`); deepseek /
 *                         o1 / claude-thinking models echo this back into next
 *                         turn's input
 * - `toolCallId`        — tool message's `tool_call_id` linking back to the
 *                         assistant tool call
 * - `toolDefinition`    — top-level `tools[]` array sent alongside messages
 *                         (function schema + description)
 */
export type TokenSourceType =
  | 'content'
  | 'toolCalls'
  | 'thoughtSignature'
  | 'reasoning'
  | 'toolCallId'
  | 'toolDefinition';

/**
 * Per-message token breakdown. `bySource` only includes non-zero entries.
 */
export interface MessageTokenBreakdown {
  /** Token counts split by source. Absent keys = 0 tokens. */
  bySource: Partial<Record<TokenSourceType, number>>;
  /** Index in the original messages array */
  index: number;
  /** Echoed from the message for UI grouping */
  role: UIChatMessage['role'];
  /** Sum of bySource values */
  total: number;
}

/**
 * Per tool-definition breakdown — useful for UI to highlight which tools are
 * the most expensive in the context budget.
 */
export interface ToolDefinitionTokenBreakdown {
  /** Best-effort tool name (function.name → name → 'unknown') */
  name: string;
  total: number;
}

/**
 * Result of {@link countContextTokens}. Provides both a per-source aggregate
 * (for "show me input by type" UI) and per-item breakdowns (for "show me which
 * messages / tools dominate" UI), plus the drift-adjusted total to feed to
 * compression triggers.
 */
export interface ContextTokenAccounting {
  /** Drift-adjusted total — equals `Math.ceil(rawTotal * driftMultiplier)` */
  adjustedTotal: number;
  /** Token totals grouped by source (always present, zero when nothing of that source) */
  bySource: Record<TokenSourceType, number>;
  /** The drift multiplier actually applied */
  driftMultiplier: number;
  /** Per-message breakdown (length = messages.length) */
  messages: MessageTokenBreakdown[];
  /** Sum of all raw token counts before drift adjustment */
  rawTotal: number;
  /** Per-tool-definition breakdown (length = tools.length) */
  tools: ToolDefinitionTokenBreakdown[];
}

/**
 * Input shape for {@link countContextTokens}.
 */
export interface CountContextTokensParams {
  /** Conversation messages — typically the same array fed into the compression check */
  messages: UIChatMessage[];
  /**
   * Optional behavior tweaks
   */
  options?: {
    /**
     * Multiplier applied to the raw total to compensate for `tokenx`'s
     * systematic under-count vs provider-side tokenizers (deepseek / openai /
     * anthropic). Empirically ~1.10–1.15× for typical mixed CJK/EN/JSON content;
     * default 1.25 leaves an extra ~10% safety margin so compression triggers
     * before the upstream tokenizer reaches the model's context limit.
     *
     * @default 1.25
     */
    driftMultiplier?: number;
  };
  /**
   * Top-level tool definitions sent to the provider in the same request. Pass
   * an empty array (or omit) when the call has no tools. The shape is
   * intentionally `unknown[]` — anything serializable works because we just
   * stringify and estimate.
   */
  tools?: unknown[];
}
