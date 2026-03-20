import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    messageCleanup?: {
      cleanedCount: number;
      totalMessages: number;
    };
  }
}

const log = debug('context-engine:processor:MessageCleanupProcessor');

/**
 * Message Cleanup Processor
 * Responsible for cleaning up redundant fields in messages, keeping only necessary fields required by OpenAI format
 */
export class MessageCleanupProcessor extends BaseProcessor {
  readonly name = 'MessageCleanupProcessor';

  constructor(options: ProcessorOptions = {}) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    let cleanedCount = 0;

    // Clean each message, keeping only necessary fields
    for (let i = 0; i < clonedContext.messages.length; i++) {
      const message = clonedContext.messages[i];
      const cleanedMessage = this.cleanMessage(message);

      if (cleanedMessage !== message) {
        clonedContext.messages[i] = cleanedMessage;
        cleanedCount++;
      }
    }

    // Update metadata
    clonedContext.metadata.messageCleanup = {
      cleanedCount,
      totalMessages: clonedContext.messages.length,
    };

    log(`Message cleanup completed, cleaned ${cleanedCount} messages`);
    return this.markAsExecuted(clonedContext);
  }

  /**
   * Clean a single message, keeping only necessary fields
   */
  private cleanMessage(message: any): any {
    switch (message.role) {
      case 'system': {
        return {
          content: message.content,
          role: message.role,
        };
      }

      case 'user': {
        return {
          content: message.content,
          role: message.role,
        };
      }

      case 'assistant': {
        return {
          content: message.content,
          role: message.role,
          ...(message.tool_calls && { tool_calls: message.tool_calls }),
          ...(message.reasoning && { reasoning: message.reasoning }),
        };
      }

      case 'tool': {
        return {
          content: message.content,
          role: message.role,
          tool_call_id: message.tool_call_id,
          ...(message.name && { name: message.name }),
        };
      }

      default: {
        // For unknown roles, keep as is
        return message;
      }
    }
  }
}
