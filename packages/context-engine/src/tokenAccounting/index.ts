// cspell:ignore tokenx
import type { AssistantContentBlock, UIChatMessage } from '@lobechat/types';
import { estimateTokenCount } from 'tokenx';

import { DEFAULT_TEMPLATE, formatTaskMessage } from '../processors/TaskMessage';
import type {
  ContextTokenAccounting,
  CountContextTokensParams,
  MessageTokenBreakdown,
  TokenSourceType,
  ToolDefinitionTokenBreakdown,
} from './types';

export * from './attachmentTokenBuckets';

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

type AssistantTokenBlock =
  | AssistantContentBlock
  | Pick<UIChatMessage, 'content' | 'metadata' | 'reasoning' | 'tools' | 'usage'>;

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
 * | `toolCallId`       | `msg.tool_call_id` + `tools[].id` (result-bearing)     | `message.tool_call_id`           |
 * | `toolDefinition`   | top-level `tools[]` param                                  | request `tools` array            |
 *
 * **Container messages** — the conversation-flow flatteners pack real
 * conversation content into display-only wrappers that the context pipeline
 * restores before sending. Counting mirrors each flattening:
 *
 *   - `assistantGroup` / `supervisor` → `children[]` (AssistantContentBlock:
 *     content + tools + thoughtSignature + reasoning + `tools[].result.content` +
 *     `tools[].id` as tool_call_id) — restored by GroupMessageFlatten
 *   - `tasks` / `groupTasks` → `tasks[]` (real task messages; `content` +
 *     `metadata.instruction` are re-emitted inside one assistant template by
 *     TasksFlatten + TaskMessageProcessor)
 *   - `agentCouncil` → `members[]` (assistant or nested assistantGroup)
 *     — restored by AgentCouncilFlatten
 *   - standalone `role: 'task'` messages use the same accounting as one
 *     entry of a `tasks` container
 *
 * **What's NOT counted (intentionally)** — these are DB-only fields the
 * harness stores but doesn't ship to the provider:
 *
 *   `plugin`, `pluginState`, `pluginIntervention`, `pluginError`, `chunksList`,
 *   `editorData`, `extra`, `fileList`, `imageList`, `videoList`, `metadata`
 *   (other than `metadata.usage.totalOutputTokens` shortcut for assistant and
 *   `metadata.instruction` for `task` messages, which ship in the template)
 * Also NOT counted: in-bubble `council` blocks (`AssistantContentBlock.council`)
 * and `taskCompletions` on group wrappers — both are UI-only denormalizations
 * (broadcast member replies / folded subagent completions) that GroupMessageFlatten
 * drops and never reach the provider. Counting them would over-estimate and
 * trigger compression too early.
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

    const countToolResults = (tools: AssistantTokenBlock['tools']) => {
      if (!Array.isArray(tools) || tools.length === 0) return;

      for (const tool of tools) {
        const result = (tool as { result?: { content?: unknown } }).result;
        if (!result) continue;

        bumpSource(bySource, 'content', estimate(result.content));
        bumpSource(bySource, 'toolCallId', estimate(tool.id));
      }
    };

    const countAssistant = (message: AssistantTokenBlock) => {
      // Assistant fast-path: recorded usage covers content + tool_calls + reasoning
      // produced by THIS turn's generation. Use it directly when available. Prefer
      // the dedicated `usage` field, falling back to legacy `metadata.usage`.
      const recordedOutputTokens =
        message.usage?.totalOutputTokens ?? message.metadata?.usage?.totalOutputTokens;

      if (recordedOutputTokens && recordedOutputTokens > 0) {
        bumpSource(bySource, 'content', recordedOutputTokens);
      } else {
        // Per-field estimation
        bumpSource(bySource, 'content', estimate(message.content));

        // Tool calls: lobe stores these on `msg.tools` (NOT OpenAI's `tool_calls`)
        // We project to what's actually sent: id + apiName + arguments + type.
        // Skipping internal-only fields (intervention, source, executor, result_msg_id)
        // which don't ship to the provider.
        // Gemini's `thoughtSignature` is preserved by ToolCallProcessor and
        // forwarded by the Google context builder — count it under its own
        // bucket since it's provider-specific and can be sizeable on every call.
        if (Array.isArray(message.tools) && message.tools.length > 0) {
          let tcSum = 0;
          let sigSum = 0;
          for (const tc of message.tools) {
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
        const reasoning = message.reasoning;
        if (reasoning) {
          const reasoningContent = typeof reasoning === 'string' ? reasoning : reasoning.content;
          bumpSource(bySource, 'reasoning', estimate(reasoningContent));
        }
      }
    };

    // `task` messages (subagent execution results) are re-emitted by
    // TaskMessageProcessor as assistant messages whose content is the full
    // instruction/result template (`[Task Result from {{agentName}}]` +
    // `{{instruction}}` + `{{content}}`). Mirror the processor exactly: when
    // `metadata.instruction` is present, estimate the formatted template
    // (static headings + agentName included), not just the two parts — short
    // results would otherwise undercount the shipped payload.
    const countTaskMessage = (task: UIChatMessage) => {
      const instruction = (task.metadata as { instruction?: unknown } | undefined)?.instruction;

      if (instruction) {
        const taskWithIdentity = task as UIChatMessage & {
          agentName?: string;
          meta?: { avatar?: string };
        };
        // Same resolution as TaskMessageProcessor: agentName || meta.avatar || 'Sub Agent'
        const agentName =
          taskWithIdentity.agentName || taskWithIdentity.meta?.avatar || 'Sub Agent';
        const formattedContent = formatTaskMessage(DEFAULT_TEMPLATE, {
          agentName: String(agentName),
          content: String(task.content || ''),
          instruction: String(instruction),
        });
        bumpSource(bySource, 'content', estimate(formattedContent));
      } else {
        // No instruction: TaskMessageProcessor converts to a plain assistant
        // message carrying only the result text.
        bumpSource(bySource, 'content', estimate(task.content));
      }

      const reasoning = task.reasoning;
      if (reasoning) {
        const reasoningContent = typeof reasoning === 'string' ? reasoning : reasoning.content;
        bumpSource(bySource, 'reasoning', estimate(reasoningContent));
      }
    };

    // assistantGroup / supervisor are display-only wrappers. Their children are
    // AssistantContentBlocks, which the context pipeline restores to assistant
    // messages followed by their inline tool results.
    const countGroupChildren = (children: AssistantContentBlock[]) => {
      for (const child of children) {
        countAssistant(child);
        countToolResults(child.tools);
      }
    };

    if (
      (msg.role === 'assistantGroup' || msg.role === 'supervisor') &&
      Array.isArray(msg.children) &&
      msg.children.length > 0
    ) {
      countGroupChildren(msg.children);
    } else if (
      (msg.role === 'tasks' || msg.role === 'groupTasks') &&
      Array.isArray(msg.tasks) &&
      msg.tasks.length > 0
    ) {
      // TasksFlatten re-emits every entry as a `task` message, which
      // TaskMessageProcessor turns into an assistant template — count each
      // task the same way a standalone `task` message is counted.
      for (const task of msg.tasks) countTaskMessage(task);
    } else if (
      msg.role === 'agentCouncil' &&
      Array.isArray(msg.members) &&
      msg.members.length > 0
    ) {
      // AgentCouncilFlatten expands members into assistant + tool messages; a
      // member can itself be a nested assistantGroup container.
      for (const member of msg.members) {
        if (
          (member.role === 'assistantGroup' || member.role === 'supervisor') &&
          Array.isArray(member.children) &&
          member.children.length > 0
        ) {
          countGroupChildren(member.children);
        } else {
          countAssistant(member);
          countToolResults(member.tools);
        }
      }
    } else if (msg.role === 'task') {
      // Standalone task message (single subagent result) — same accounting as
      // one entry of a `tasks` container.
      countTaskMessage(msg);
    } else {
      if (msg.role === 'assistant') {
        countAssistant(msg);
      } else {
        bumpSource(bySource, 'content', estimate(msg.content));

        const reasoning = msg.reasoning;
        if (reasoning) {
          const reasoningContent = typeof reasoning === 'string' ? reasoning : reasoning.content;
          bumpSource(bySource, 'reasoning', estimate(reasoningContent));
        }
      }

      // Tool result content is shipped to the provider as the `tool` message —
      // group children carry it inline on `tools[].result.content`. Count it
      // regardless of the fast-path above (recorded assistant usage never covers
      // the results of its own tool calls).
      countToolResults(msg.tools);

      // tool_call_id is sent regardless of fast-path (it's on `tool` role messages,
      // not assistant)
      if (msg.tool_call_id) {
        bumpSource(bySource, 'toolCallId', estimate(msg.tool_call_id));
      }
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
