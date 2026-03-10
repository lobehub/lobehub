import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { MessageToolCall, PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:processor:ToolCallProcessor');

export interface ToolCallConfig {
  /** Function to generate tool calling name */
  genToolCallingName?: (identifier: string, apiName: string, type?: string) => string;
  /** Function to check if function calling is supported */
  isCanUseFC?: (model: string, provider: string) => boolean;
  /** Model name */
  model: string;
  /** Provider name */
  provider: string;
}

/**
 * Tool Call Processor
 * Responsible for converting ChatMessage format tool calls to OpenAI format
 */
export class ToolCallProcessor extends BaseProcessor {
  readonly name = 'ToolCallProcessor';

  constructor(
    private config: ToolCallConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    const supportTools = this.config.isCanUseFC
      ? this.config.isCanUseFC(this.config.model, this.config.provider)
      : true;

    let processedCount = 0;
    let toolCallsConverted = 0;
    let toolMessagesConverted = 0;

    // Process tool calls for each message
    for (let i = 0; i < clonedContext.messages.length; i++) {
      const message = clonedContext.messages[i];

      try {
        const updatedMessage = await this.processMessage(message, supportTools);

        if (updatedMessage !== message) {
          processedCount++;
          clonedContext.messages[i] = updatedMessage;

          // Count converted tool calls and tool messages
          if (message.role === 'assistant' && message.tools) {
            toolCallsConverted += message.tools.length;
          }
          if (message.role === 'tool') {
            toolMessagesConverted++;
          }

          log(`Processed message ${message.id}, role: ${message.role}`);
        }
      } catch (error) {
        log.extend('error')(`Error processing tool call in message ${message.id}: ${error}`);
        // Continue processing other messages
      }
    }

    // Update metadata
    clonedContext.metadata.toolCallProcessed = processedCount;
    clonedContext.metadata.toolCallsConverted = toolCallsConverted;
    clonedContext.metadata.toolMessagesConverted = toolMessagesConverted;
    clonedContext.metadata.supportTools = supportTools;

    log(
      `Tool call processing completed, processed ${processedCount} messages, converted ${toolCallsConverted} tool calls, ${toolMessagesConverted} tool messages`,
    );

    return this.markAsExecuted(clonedContext);
  }

  /**
   * Process tool calls for a single message
   */
  private async processMessage(message: any, supportTools: boolean): Promise<any> {
    switch (message.role) {
      case 'assistant': {
        return this.processAssistantMessage(message, supportTools);
      }

      case 'tool': {
        return this.processToolMessage(message, supportTools);
      }

      default: {
        return message;
      }
    }
  }

  /**
   * Process tool calls in assistant message
   */
  private processAssistantMessage(message: any, supportTools: boolean): any {
    // Check if there are tool calls
    const hasTools = message.tools && message.tools.length > 0;
    const hasEmptyToolCalls = message.tool_calls && message.tool_calls.length === 0;

    if (!supportTools || (!hasTools && hasEmptyToolCalls)) {
      // If tools not supported or only has empty tool calls, return regular message (remove tool-related properties)

      const { tools, tool_calls, ...messageWithoutTools } = message;
      return messageWithoutTools;
    }

    if (!hasTools) {
      // If no tools but has other tool call properties, only remove tools
      return message;
    }

    // Convert tools to tool_calls format
    const tool_calls = message.tools.map(
      (tool: any): MessageToolCall => ({
        function: {
          arguments: tool.arguments,
          name: this.config.genToolCallingName
            ? this.config.genToolCallingName(tool.identifier, tool.apiName, tool.type)
            : `${tool.identifier}.${tool.apiName}`,
        },
        id: tool.id,
        thoughtSignature: tool.thoughtSignature,
        type: 'function',
      }),
    );

    return { ...message, tool_calls };
  }

  /**
   * Process tool message
   */
  private processToolMessage(message: any, supportTools: boolean): any {
    if (!supportTools) {
      // If tools not supported, convert tool message to user message
      return {
        ...message,
        name: undefined,
        plugin: undefined,
        role: 'user',
        tool_call_id: undefined,
      };
    }

    // Generate tool name
    const toolName = message.plugin
      ? this.config.genToolCallingName
        ? this.config.genToolCallingName(
            message.plugin.identifier,
            message.plugin.apiName,
            message.plugin.type,
          )
        : `${message.plugin.identifier}.${message.plugin.apiName}`
      : undefined;

    return {
      ...message,
      name: toolName,
      // Keep tool_call_id for association
    };
  }

  /**
   * Validate tool call format
   */
  private validateToolCall(tool: any): boolean {
    return !!(tool && tool.id && tool.identifier && tool.apiName && tool.arguments);
  }

  /**
   * Validate tool message format
   */
  private validateToolMessage(message: any): boolean {
    return !!(message && message.tool_call_id && message.content !== undefined);
  }
}
