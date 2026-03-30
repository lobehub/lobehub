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

const DEFAULT_TOOL_FAILURE_CONTENT = JSON.stringify({
  error: 'Tool call failed',
  success: false,
  synthetic: true,
});

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
   */
  private reorderToolMessages(messages: any[]): {
    removedInvalidTools: number;
    reorderedMessages: any[];
  } {
    let removedInvalidTools = 0;
    const validToolCallIds = new Set<string>();
    const toolMessages = new Map<string, any>();

    // 1. First collect all valid tool_call_ids from assistant messages
    for (const message of messages) {
      if (message.role !== 'assistant' || !Array.isArray(message.tool_calls)) continue;

      const seenToolCallIds = new Set<string>();
      for (const toolCall of message.tool_calls) {
        if (!toolCall?.id) continue;

        if (seenToolCallIds.has(toolCall.id)) continue;

        seenToolCallIds.add(toolCall.id);
        validToolCallIds.add(toolCall.id);
      }
    }

    // 2. Collect all valid tool messages
    for (const message of messages) {
      if (message.role !== 'tool') continue;

      // Skip invalid tool messages
      if (!message.tool_call_id || !validToolCallIds.has(message.tool_call_id)) {
        removedInvalidTools++;
        continue;
      }

      if (toolMessages.has(message.tool_call_id)) {
        // Check if this tool message has already been added
        removedInvalidTools++;
        continue;
      }

      toolMessages.set(message.tool_call_id, message);
    }

    // 3. Reorder messages
    const reorderedMessages: any[] = [];

    for (const [index, message] of messages.entries()) {
      if (message.role === 'tool') continue;

      if (message.role !== 'assistant' || !Array.isArray(message.tool_calls)) {
        reorderedMessages.push(message);
        continue;
      }

      const seenToolCallIds = new Set<string>();
      const normalizedToolCalls = [];

      for (const toolCall of message.tool_calls) {
        if (!toolCall?.id) continue;

        if (seenToolCallIds.has(toolCall.id)) continue;

        seenToolCallIds.add(toolCall.id);
        normalizedToolCalls.push(toolCall);
      }

      reorderedMessages.push(
        normalizedToolCalls.length === message.tool_calls.length
          ? message
          : { ...message, tool_calls: normalizedToolCalls },
      );

      // If assistant message with tool_calls, add corresponding tool messages
      for (const toolCall of normalizedToolCalls) {
        const matchedToolMessage = toolMessages.get(toolCall.id);

        if (matchedToolMessage) {
          const pluginErrorMessage =
            typeof matchedToolMessage.pluginError?.message === 'string'
              ? matchedToolMessage.pluginError.message
              : undefined;

          reorderedMessages.push({
            ...matchedToolMessage,
            content:
              typeof matchedToolMessage.content === 'string' &&
              (matchedToolMessage.content.length > 0 || !pluginErrorMessage)
                ? matchedToolMessage.content
                : pluginErrorMessage || DEFAULT_TOOL_FAILURE_CONTENT,
          });
          toolMessages.delete(toolCall.id);
          continue;
        }

        reorderedMessages.push({
          content: DEFAULT_TOOL_FAILURE_CONTENT,
          ...(toolCall.function?.name && { name: toolCall.function.name }),
          role: 'tool',
          tool_call_id: toolCall.id,
        });
      }
    }

    return { reorderedMessages, removedInvalidTools };
  }

  // Simplified: removed validation/statistics helper methods
}
