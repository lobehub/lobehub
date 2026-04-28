import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { Message, PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    disabledToolCallFilter?: {
      filteredAssistantMessages: number;
      filteredToolCalls: number;
    };
  }
}

const log = debug('context-engine:processor:DisabledToolCallFilter');

export interface DisabledToolCallFilterConfig {
  disabledToolIdentifiers?: string[];
}

const TOOL_NAME_SEPARATOR = '____';

const isDisabledToolName = (name: string | undefined, disabledToolIdentifiers: Set<string>) => {
  if (!name) return false;

  for (const identifier of disabledToolIdentifiers) {
    if (name === identifier || name.startsWith(`${identifier}${TOOL_NAME_SEPARATOR}`)) {
      return true;
    }
  }

  return false;
};

/**
 * Removes historical tool calls for tools that are not valid in the current runtime scope.
 *
 * Some models infer tool names from prior assistant/tool messages even when the current
 * request's `tools` schema no longer contains that tool. Filtering the historical call
 * removes that imitation path; ToolMessageReorder will then drop the orphaned tool result.
 */
export class DisabledToolCallFilter extends BaseProcessor {
  readonly name = 'DisabledToolCallFilter';

  constructor(
    private config: DisabledToolCallFilterConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const disabledToolIdentifiers = new Set(this.config.disabledToolIdentifiers ?? []);

    if (disabledToolIdentifiers.size === 0) {
      return this.markAsExecuted(context);
    }

    const clonedContext = this.cloneContext(context);
    let filteredAssistantMessages = 0;
    let filteredToolCalls = 0;

    clonedContext.messages = clonedContext.messages.map((message) => {
      if (message.role !== 'assistant') return message;

      const nextMessage = this.filterAssistantMessage(message, disabledToolIdentifiers);
      if (nextMessage === message) return message;

      filteredAssistantMessages++;
      filteredToolCalls +=
        (Array.isArray(message.tool_calls) ? message.tool_calls.length : 0) -
        (Array.isArray(nextMessage.tool_calls) ? nextMessage.tool_calls.length : 0);

      return nextMessage;
    });

    clonedContext.metadata.disabledToolCallFilter = {
      filteredAssistantMessages,
      filteredToolCalls,
    };

    if (filteredToolCalls > 0) {
      log(
        'Filtered %d disabled tool calls from %d assistant messages',
        filteredToolCalls,
        filteredAssistantMessages,
      );
    }

    return this.markAsExecuted(clonedContext);
  }

  private filterAssistantMessage(message: Message, disabledToolIdentifiers: Set<string>): Message {
    let nextMessage = message;

    if (Array.isArray(message.tool_calls)) {
      const toolCalls = message.tool_calls.filter(
        (toolCall) => !isDisabledToolName(toolCall?.function?.name, disabledToolIdentifiers),
      );

      if (toolCalls.length !== message.tool_calls.length) {
        const messageWithoutToolCalls = { ...nextMessage };
        delete messageWithoutToolCalls.tool_calls;
        nextMessage =
          toolCalls.length > 0
            ? { ...nextMessage, tool_calls: toolCalls }
            : messageWithoutToolCalls;
      }
    }

    if (Array.isArray(message.tools)) {
      const tools = message.tools.filter(
        (tool) => !disabledToolIdentifiers.has(String(tool?.identifier ?? '')),
      );

      if (tools.length !== message.tools.length) {
        const messageWithoutTools = { ...nextMessage };
        delete messageWithoutTools.tools;
        nextMessage = tools.length > 0 ? { ...nextMessage, tools } : messageWithoutTools;
      }
    }

    return nextMessage;
  }
}
