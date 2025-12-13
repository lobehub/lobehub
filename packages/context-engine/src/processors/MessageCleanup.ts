import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:processor:MessageCleanupProcessor');

/**
 * 消息清理处理器
 * 负责清理消息中的多余字段，只保留 OpenAI 格式所需的必要字段
 */
export class MessageCleanupProcessor extends BaseProcessor {
  readonly name = 'MessageCleanupProcessor';

  constructor(options: ProcessorOptions = {}) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    let cleanedCount = 0;

    // 清理每条消息，只保留必要字段
    for (let i = 0; i < clonedContext.messages.length; i++) {
      const message = clonedContext.messages[i];
      const cleanedMessage = this.cleanMessage(message);

      if (cleanedMessage !== message) {
        clonedContext.messages[i] = cleanedMessage;
        cleanedCount++;
      }
    }

    // 更新元数据
    clonedContext.metadata.messageCleanup = {
      cleanedCount,
      totalMessages: clonedContext.messages.length,
    };

    log(`Message cleanup completed, cleaned ${cleanedCount} messages`);
    return this.markAsExecuted(clonedContext);
  }

  /**
   * 清理单条消息，只保留必要字段
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
        // 对于未知角色，保持原样
        return message;
      }
    }
  }
}
