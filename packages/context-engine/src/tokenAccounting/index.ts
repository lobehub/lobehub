import { estimateTokenCount } from 'tokenx';

import type {
  ContextTokenAccounting,
  CountContextTokensParams,
  MessageTokenBreakdown,
  TokenSourceType,
  ToolDefinitionTokenBreakdown,
} from './types';

export const DEFAULT_DRIFT_MULTIPLIER = 1.25;

const ZERO_BY_SOURCE = (): Record<TokenSourceType, number> => ({
  content: 0,
  reasoning: 0,
  thoughtSignature: 0,
  toolCallId: 0,
  toolCalls: 0,
  toolDefinition: 0,
});

const estimate = (value: unknown): number => {
  if (value == null) return 0;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text ? estimateTokenCount(text) : 0;
};

const bumpSource = (
  bySource: Partial<Record<TokenSourceType, number>>,
  key: TokenSourceType,
  amount: number,
) => {
  if (amount <= 0) return;
  bySource[key] = (bySource[key] ?? 0) + amount;
};

/**
 * Account every token that will be sent to the provider for one chat request,
 * broken down by source category and per-item.
 *
 * **What's counted (and why)**
 * | source             | field on UIChatMessage                                     | sent to provider as              |
 * |--------------------|------------------------------------------------------------|----------------------------------|
 * | `content`          | `msg.content`                                              | `message.content`                |
 * | `toolCalls`        | `msg.tools[]` (lobe internal, not OpenAI's `tool_calls`)   | `message.tool_calls`             |
 * | `thoughtSignature` | `msg.tools[N].thoughtSignature` (Gemini-specific)          | echoed back per tool call        |
 * | `reasoning`        | `msg.reasoning.content` / `msg.reasoning` (string variant) | echoed back next turn (thinking) |
 * | `toolCallId`       | `msg.tool_call_id`                                         | `message.tool_call_id`           |
 * | `toolDefinition`   | top-level `tools[]` param                                  | request `tools` array            |
 *
 * **What's NOT counted (intentionally)** — these are DB-only fields the
 * harness stores but doesn't ship to the provider:
 *
 *   `plugin`, `pluginState`, `pluginIntervention`, `pluginError`, `chunksList`,
 *   `editorData`, `extra`, `fileList`, `imageList`, `videoList`, `metadata`
 *   (other than `metadata.usage.totalOutputTokens` shortcut for assistant)
 *
 * Counting them would over-estimate and trigger compression too early.
 *
 * **Token estimation accuracy**
 *
 * Uses the `tokenx` heuristic estimator (~96% accuracy on typical English text).
 * For agent conversations heavy in JSON / code / mixed CJK, `tokenx` typically
 * under-counts by 10–15% vs provider tokenizers. The default
 * `driftMultiplier: 1.25` compensates for that drift PLUS leaves ~10% headroom
 * so callers using the result as a compression trigger fire before the upstream
 * tokenizer reaches its limit.
 *
 * **Assistant fast-path**
 *
 * If an assistant message has `metadata.usage.totalOutputTokens > 0`, that
 * recorded provider-side count is used for `content` (skipping per-field
 * estimation for that message), since it already covers the assistant's
 * content + tool_calls + reasoning that the provider tokenized. Other sources
 * (incoming tool messages' `tool_call_id`, etc.) are still added separately.
 *
 * @example
 * const accounting = countContextTokens({
 *   messages: state.messages,
 *   tools: payload.tools,
 * });
 *
 * // Compression trigger:
 * if (accounting.adjustedTotal > threshold) compress();
 *
 * // UI "context by type" panel:
 * accounting.bySource;
 * // → { content: 267058, toolCalls: 201762, reasoning: 110107, toolCallId: 758, toolDefinition: 14339 }
 *
 * // UI per-message inspector:
 * accounting.messages;
 * // → [{ index: 0, role: 'user', bySource: { content: 1234 }, total: 1234 }, ...]
 */
export const countContextTokens = ({
  messages,
  tools = [],
  options,
}: CountContextTokensParams): ContextTokenAccounting => {
  const driftMultiplier = options?.driftMultiplier ?? DEFAULT_DRIFT_MULTIPLIER;

  const messageBreakdowns: MessageTokenBreakdown[] = messages.map((msg, index) => {
    const bySource: Partial<Record<TokenSourceType, number>> = {};

    // Assistant fast-path: recorded usage covers content + tool_calls + reasoning
    // produced by THIS turn's generation. Use it directly when available.
    const recordedOutputTokens =
      msg.role === 'assistant' ? msg.metadata?.usage?.totalOutputTokens : undefined;

    if (recordedOutputTokens && recordedOutputTokens > 0) {
      bumpSource(bySource, 'content', recordedOutputTokens);
    } else {
      // Per-field estimation
      bumpSource(bySource, 'content', estimate(msg.content));

      // Tool calls: lobe stores these on `msg.tools` (NOT OpenAI's `tool_calls`)
      // We project to what's actually sent: id + apiName + arguments + type.
      // Skipping internal-only fields (intervention, source, executor, result_msg_id)
      // which don't ship to the provider.
      // Gemini's `thoughtSignature` is preserved by ToolCallProcessor and
      // forwarded by the Google context builder — count it under its own
      // bucket since it's provider-specific and can be sizeable on every call.
      if (msg.role === 'assistant' && Array.isArray(msg.tools) && msg.tools.length > 0) {
        let tcSum = 0;
        let sigSum = 0;
        for (const tc of msg.tools) {
          tcSum += estimate(tc.id);
          tcSum += estimate(tc.apiName);
          tcSum += estimate(tc.arguments);
          tcSum += estimate(tc.type);
          sigSum += estimate(tc.thoughtSignature);
        }
        bumpSource(bySource, 'toolCalls', tcSum);
        bumpSource(bySource, 'thoughtSignature', sigSum);
      }

      // Reasoning trace (thinking-mode models echo this back next turn)
      const reasoning = msg.reasoning;
      if (reasoning) {
        const reasoningContent = typeof reasoning === 'string' ? reasoning : reasoning.content;
        bumpSource(bySource, 'reasoning', estimate(reasoningContent));
      }
    }

    // tool_call_id is sent regardless of fast-path (it's on `tool` role messages,
    // not assistant)
    if (msg.tool_call_id) {
      bumpSource(bySource, 'toolCallId', estimate(msg.tool_call_id));
    }

    let total = 0;
    for (const v of Object.values(bySource)) total += v ?? 0;

    return { bySource, index, role: msg.role, total };
  });

  // Tool definitions
  const toolBreakdowns: ToolDefinitionTokenBreakdown[] = tools.map((tool) => {
    const t = tool as { function?: { name?: string }; name?: string };
    return {
      name: t.function?.name ?? t.name ?? 'unknown',
      total: estimate(tool),
    };
  });

  // Aggregate
  const bySource = ZERO_BY_SOURCE();
  for (const m of messageBreakdowns) {
    for (const [k, v] of Object.entries(m.bySource)) {
      bySource[k as TokenSourceType] += v ?? 0;
    }
  }
  bySource.toolDefinition = toolBreakdowns.reduce((s, t) => s + t.total, 0);

  let rawTotal = 0;
  for (const v of Object.values(bySource)) rawTotal += v;

  return {
    adjustedTotal: Math.ceil(rawTotal * driftMultiplier),
    bySource,
    driftMultiplier,
    messages: messageBreakdowns,
    rawTotal,
    tools: toolBreakdowns,
  };
};

export type {
  ContextTokenAccounting,
  CountContextTokensParams,
  MessageTokenBreakdown,
  TokenSourceType,
  ToolDefinitionTokenBreakdown,
} from './types';
