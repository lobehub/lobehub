import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { Message, PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    historicalWebSearchResultFilter?: {
      removedToolMessages: number;
      strippedAssistantMessages: number;
      strippedToolCalls: number;
    };
  }
}

const log = debug('context-engine:processor:HistoricalWebSearchResultFilter');

const WEB_BROWSING_IDENTIFIER = 'lobe-web-browsing';
const TOOL_NAME_SEPARATOR = '____';

const isSearchApiName = (apiName: unknown) =>
  typeof apiName === 'string' && apiName.toLowerCase().includes('search');

const isWebSearchToolPayload = (tool: any) => {
  if (!tool) return false;

  if (tool.identifier === WEB_BROWSING_IDENTIFIER) {
    return isSearchApiName(tool.apiName);
  }

  // Legacy/imported payloads may use a generic builtin identifier with web_search.
  return tool.apiName === 'web_search';
};

const isWebSearchToolName = (name: unknown) => {
  if (typeof name !== 'string') return false;

  return (
    name === 'web_search' ||
    name.startsWith(`${WEB_BROWSING_IDENTIFIER}${TOOL_NAME_SEPARATOR}search`) ||
    name.startsWith(`${WEB_BROWSING_IDENTIFIER}${TOOL_NAME_SEPARATOR}web_search`)
  );
};

const getHistoricalBoundary = (messages: Message[]) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return i;
  }

  return -1;
};

/**
 * Removes raw historical web-search tool results from model context.
 *
 * Web search results are useful for the turn that produced them, but replaying
 * large raw result payloads into later turns burns tokens and slows responses.
 * The assistant's final answer and `search` grounding metadata remain intact.
 */
export class HistoricalWebSearchResultFilter extends BaseProcessor {
  readonly name = 'HistoricalWebSearchResultFilter';

  constructor(options: ProcessorOptions = {}) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const latestUserIndex = getHistoricalBoundary(context.messages);

    if (latestUserIndex <= 0) {
      return this.markAsExecuted(context);
    }

    const clonedContext = this.cloneContext(context);
    const historicalWebSearchToolCallIds = new Set<string>();
    let strippedAssistantMessages = 0;
    let strippedToolCalls = 0;

    clonedContext.messages = clonedContext.messages.map((message, index) => {
      if (index >= latestUserIndex || message.role !== 'assistant') return message;

      const nextMessage = { ...message };
      let changed = false;

      if (Array.isArray(message.tools)) {
        const tools = message.tools.filter((tool: any) => {
          if (!isWebSearchToolPayload(tool)) return true;

          if (tool.id) historicalWebSearchToolCallIds.add(String(tool.id));
          strippedToolCalls++;
          return false;
        });

        if (tools.length !== message.tools.length) {
          changed = true;
          if (tools.length > 0) nextMessage.tools = tools;
          else delete nextMessage.tools;
        }
      }

      if (Array.isArray(message.tool_calls)) {
        const toolCalls = message.tool_calls.filter((toolCall: any) => {
          const isHistoricalWebSearch =
            historicalWebSearchToolCallIds.has(String(toolCall?.id ?? '')) ||
            isWebSearchToolName(toolCall?.function?.name);

          if (!isHistoricalWebSearch) return true;

          if (toolCall?.id) historicalWebSearchToolCallIds.add(String(toolCall.id));
          strippedToolCalls++;
          return false;
        });

        if (toolCalls.length !== message.tool_calls.length) {
          changed = true;
          if (toolCalls.length > 0) nextMessage.tool_calls = toolCalls;
          else delete nextMessage.tool_calls;
        }
      }

      if (!changed) return message;

      strippedAssistantMessages++;
      return nextMessage;
    });

    let removedToolMessages = 0;
    clonedContext.messages = clonedContext.messages.filter((message, index) => {
      if (index >= latestUserIndex || message.role !== 'tool') return true;

      const isHistoricalWebSearch =
        historicalWebSearchToolCallIds.has(String(message.tool_call_id ?? '')) ||
        isWebSearchToolPayload(message.plugin) ||
        isWebSearchToolName(message.name);

      if (!isHistoricalWebSearch) return true;

      removedToolMessages++;
      return false;
    });

    clonedContext.metadata.historicalWebSearchResultFilter = {
      removedToolMessages,
      strippedAssistantMessages,
      strippedToolCalls,
    };

    if (removedToolMessages > 0 || strippedToolCalls > 0) {
      log(
        'Filtered %d historical web search tool calls and %d tool result messages',
        strippedToolCalls,
        removedToolMessages,
      );
    }

    return this.markAsExecuted(clonedContext);
  }
}
