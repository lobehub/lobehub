import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    toolMessageReorder?: {
      originalCount: number;
      removedInvalidTools: number;
      reorderedCount: number;
    };
  }
}

const log = debug('context-engine:processor:ToolMessageReorder');

/**
 * Why a synthetic failure payload was injected. The model sees these fields,
 * so the wording doubles as a diagnosis: it can tell whether the tool may
 * still have executed (result lost in transport) versus ran and produced
 * nothing usable — instead of guessing from an opaque "Tool call failed".
 */
type SyntheticToolFailureReason = 'tool_result_missing' | 'tool_result_unusable';

/**
 * Model-readable hint per reason. The retry-safety distinction is the point:
 * a missing result says nothing about whether the call executed — it may well
 * have — so blindly retrying a side-effecting tool can repeat its effects.
 * Kept to one sentence each: this payload rides along in every request until
 * the failed call ages out of context.
 */
export const SYNTHETIC_TOOL_FAILURE_HINTS: Record<SyntheticToolFailureReason, string> = {
  tool_result_missing:
    'No result arrived, so whether the call actually executed is unknown; check observable state before retrying tools with side effects.',
  tool_result_unusable:
    'The call returned no readable content and no error message; check the inputs before retrying, as a retry may return the same.',
};

export const syntheticToolFailureContent = (reason: SyntheticToolFailureReason, tool?: string) =>
  JSON.stringify({
    error: 'Tool call failed',
    hint: SYNTHETIC_TOOL_FAILURE_HINTS[reason],
    reason,
    success: false,
    synthetic: true,
    ...(tool ? { tool } : {}),
  });

/**
 * Whether a tool result still carries something the model can read.
 *
 * `MessageContentProcessor` rewrites a tool result that produced images (e.g.
 * `readFile` on a screenshot, which uploads the file and carries the URL on
 * `pluginState.images`) into multimodal parts — `[{ type: 'text' }, { type:
 * 'image_url' }]` — whenever the model supports vision. A bare
 * `typeof content === 'string'` guard therefore rejects exactly the results
 * that carry an image: this pass would drop the parts and hand the model
 * {@link syntheticToolFailureContent} instead, so a successful screenshot read
 * arrived as "Tool call failed" and the image never reached the request at all.
 */
const hasUsableToolContent = (content: unknown, pluginErrorMessage?: string): boolean => {
  // Multimodal parts (text + image_url / video_url / audio_url).
  if (Array.isArray(content)) return content.length > 0;
  if (typeof content !== 'string') return false;

  // An empty string is a legitimate result for a tool that produced no output —
  // unless the row also recorded an error, in which case the error text is the
  // more useful thing to show the model.
  return content.length > 0 || !pluginErrorMessage;
};

/**
 * Reorder tool messages to ensure that tool messages are displayed in the correct order.
 * see https://github.com/lobehub/lobe-chat/pull/3155
 */
export class ToolMessageReorder extends BaseProcessor {
  readonly name = 'ToolMessageReorder';

  constructor(options: ProcessorOptions = {}) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    // Reorder messages
    const { reorderedMessages, removedInvalidTools } = this.reorderToolMessages(
      clonedContext.messages,
    );

    const originalCount = clonedContext.messages.length;
    const reorderedCount = reorderedMessages.length;

    clonedContext.messages = reorderedMessages;

    // Update metadata
    clonedContext.metadata.toolMessageReorder = {
      originalCount,
      removedInvalidTools,
      reorderedCount,
    };

    if (removedInvalidTools > 0) {
      log(
        'Tool message reordering completed, removed',
        removedInvalidTools,
        'invalid tool messages',
      );
    } else {
      log('Tool message reordering completed, message order optimized');
    }

    return this.markAsExecuted(clonedContext);
  }

  /**
   * Reorder tool messages
   *
   * `tool_call_id` is provider-supplied and NOT unique across a conversation:
   * Kimi (via zeabur / nvidia / moonshot) numbers calls per response, so every
   * step calls `<tool>:0` (`<tool>_0` via giteeai), and OpenRouter DeepSeek
   * reuses `call_0`. Results are therefore paired with the call they answer by
   * position — the nearest preceding assistant that made that call — not by a
   * conversation-wide id map, which handed step 1's result to step 1 only and
   * replaced every later step's real result with `tool_result_missing`. Reused
   * ids are then made unique in the request, since strict providers reject a
   * conversation that repeats a tool call id.
   */
  private reorderToolMessages(messages: any[]): {
    removedInvalidTools: number;
    reorderedMessages: any[];
  } {
    let removedInvalidTools = 0;
    // assistant message index → its tool calls with in-message duplicates removed
    const callsByAssistant = new Map<number, any[]>();
    // tool_call_id → indexes of the assistant messages that made that call
    const callersById = new Map<string, number[]>();

    // 1. Collect the tool calls of every assistant message
    for (const [index, message] of messages.entries()) {
      if (message.role !== 'assistant' || !Array.isArray(message.tool_calls)) continue;

      const seenToolCallIds = new Set<string>();
      const normalizedToolCalls = [];

      for (const toolCall of message.tool_calls) {
        if (!toolCall?.id) continue;

        if (seenToolCallIds.has(toolCall.id)) continue;

        seenToolCallIds.add(toolCall.id);
        normalizedToolCalls.push(toolCall);

        const callers = callersById.get(toolCall.id) ?? [];
        callers.push(index);
        callersById.set(toolCall.id, callers);
      }

      callsByAssistant.set(index, normalizedToolCalls);
    }

    // 2. Attach each tool message to the call it answers
    const resultKey = (assistantIndex: number, toolCallId: string) =>
      `${assistantIndex}:${toolCallId}`;
    const toolMessages = new Map<string, any>();

    for (const [index, message] of messages.entries()) {
      if (message.role !== 'tool') continue;

      const callers = message.tool_call_id ? callersById.get(message.tool_call_id) : undefined;

      // Skip invalid tool messages
      if (!callers) {
        removedInvalidTools++;
        continue;
      }

      const unanswered = callers.filter(
        (callerIndex) => !toolMessages.has(resultKey(callerIndex, message.tool_call_id)),
      );
      // The nearest call before the result; a result stored ahead of its call
      // (out-of-order rows) answers the next unanswered one.
      const callerIndex =
        unanswered.findLast((callerIndex) => callerIndex < index) ?? unanswered[0];

      if (callerIndex === undefined) {
        // Every call with this id already has a result
        removedInvalidTools++;
        continue;
      }

      toolMessages.set(resultKey(callerIndex, message.tool_call_id), message);
    }

    // 3. Reorder messages
    const reorderedMessages: any[] = [];
    const emittedToolCallIds = new Set<string>();

    // Deterministic, so a request prefix stays byte-stable across steps
    const uniqueToolCallId = (toolCallId: string) => {
      if (!emittedToolCallIds.has(toolCallId)) return toolCallId;

      let occurrence = 2;
      let candidate = `${toolCallId}_${occurrence}`;
      while (callersById.has(candidate) || emittedToolCallIds.has(candidate)) {
        occurrence++;
        candidate = `${toolCallId}_${occurrence}`;
      }

      return candidate;
    };

    for (const [index, message] of messages.entries()) {
      if (message.role === 'tool') continue;

      const normalizedToolCalls = callsByAssistant.get(index);

      if (!normalizedToolCalls) {
        reorderedMessages.push(message);
        continue;
      }

      const requestToolCalls = normalizedToolCalls.map((toolCall) => {
        const id = uniqueToolCallId(toolCall.id);
        emittedToolCallIds.add(id);

        return id === toolCall.id ? toolCall : { ...toolCall, id };
      });

      reorderedMessages.push(
        requestToolCalls.length === message.tool_calls.length &&
          requestToolCalls.every((toolCall, i) => toolCall === message.tool_calls[i])
          ? message
          : { ...message, tool_calls: requestToolCalls },
      );

      // If assistant message with tool_calls, add corresponding tool messages
      for (const [i, toolCall] of normalizedToolCalls.entries()) {
        const requestToolCallId = requestToolCalls[i].id;
        const matchedToolMessage = toolMessages.get(resultKey(index, toolCall.id));

        if (matchedToolMessage) {
          const pluginErrorMessage =
            typeof matchedToolMessage.pluginError?.message === 'string'
              ? matchedToolMessage.pluginError.message
              : undefined;

          const toolName = toolCall.function?.name;

          reorderedMessages.push({
            ...matchedToolMessage,
            content: hasUsableToolContent(matchedToolMessage.content, pluginErrorMessage)
              ? matchedToolMessage.content
              : pluginErrorMessage || syntheticToolFailureContent('tool_result_unusable', toolName),
            tool_call_id: requestToolCallId,
          });
          continue;
        }

        reorderedMessages.push({
          // The tool result never arrived (transport loss, gateway error,
          // crash). Flag it explicitly so the model can tell this apart from a
          // tool that ran and returned something unusable — and so retry
          // decisions are not made blind.
          content: syntheticToolFailureContent('tool_result_missing', toolCall.function?.name),
          ...(toolCall.function?.name && { name: toolCall.function.name }),
          role: 'tool',
          tool_call_id: requestToolCallId,
        });
      }
    }

    return { reorderedMessages, removedInvalidTools };
  }

  // Simplified: removed validation/statistics helper methods
}
