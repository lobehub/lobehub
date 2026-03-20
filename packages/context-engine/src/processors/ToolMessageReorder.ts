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
    const reorderedMessages = this.reorderToolMessages(clonedContext.messages);

    const originalCount = clonedContext.messages.length;
    const reorderedCount = reorderedMessages.length;

    clonedContext.messages = reorderedMessages;

    // Update metadata
    clonedContext.metadata.toolMessageReorder = {
      originalCount,
      removedInvalidTools: originalCount - reorderedCount,
      reorderedCount,
    };

    if (originalCount !== reorderedCount) {
      log(
        'Tool message reordering completed, removed',
        originalCount - reorderedCount,
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
  private reorderToolMessages(messages: any[]): any[] {
    // 1. First collect all valid tool_call_ids from assistant messages
    const validToolCallIds = new Set<string>();
    messages.forEach((message) => {
      if (message.role === 'assistant' && message.tool_calls) {
        message.tool_calls.forEach((toolCall: any) => {
          validToolCallIds.add(toolCall.id);
        });
      }
    });

    // 2. Collect all valid tool messages
    const toolMessages: Record<string, any> = {};
    messages.forEach((message) => {
      if (
        message.role === 'tool' &&
        message.tool_call_id &&
        validToolCallIds.has(message.tool_call_id)
      ) {
        toolMessages[message.tool_call_id] = message;
      }
    });

    // 3. Reorder messages
    const reorderedMessages: any[] = [];
    messages.forEach((message) => {
      // Skip invalid tool messages
      if (
        message.role === 'tool' &&
        (!message.tool_call_id || !validToolCallIds.has(message.tool_call_id))
      ) {
        log('Skipping invalid tool message:', message.id);
        return;
      }

      // Check if this tool message has already been added
      const hasPushed = reorderedMessages.some(
        (m) => !!message.tool_call_id && m.tool_call_id === message.tool_call_id,
      );

      if (hasPushed) return;

      reorderedMessages.push(message);

      // If assistant message with tool_calls, add corresponding tool messages
      if (message.role === 'assistant' && message.tool_calls) {
        message.tool_calls.forEach((toolCall: any) => {
          const correspondingToolMessage = toolMessages[toolCall.id];
          if (correspondingToolMessage) {
            reorderedMessages.push(correspondingToolMessage);
            delete toolMessages[toolCall.id];
          }
        });
      }
    });

    return reorderedMessages;
  }

  // Simplified: removed validation/statistics helper methods
}
