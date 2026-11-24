import type { OpenAIChatMessage } from '../../../types';

export interface ToolCallPairing {
  /** Ids of free-form (`custom`) tool calls, whose outputs use the custom output item. */
  customToolCallIds: Set<string>;
  /** Ids of tool calls that have a tool message answering them. */
  pairedToolOutputIds: Set<string>;
}

/**
 * Match assistant tool calls with the tool messages that answer them.
 *
 * The Responses API rejects an input that keeps a `function_call` without its
 * `function_call_output`. Example from production:
 * "No tool output found for function call call_w5odMFjtXEYBBVyBUAQNMOh5."
 */
export const collectToolCallPairing = (messages: OpenAIChatMessage[]): ToolCallPairing => {
  const validToolCallIds = new Set<string>();
  const pairedToolOutputIds = new Set<string>();
  const customToolCallIds = new Set<string>();

  for (const message of messages) {
    if (message.role === 'assistant' && message.tool_calls?.length) {
      message.tool_calls.forEach((tool) => {
        if (tool.id) validToolCallIds.add(tool.id);
        if (tool.id && tool.type === 'custom') customToolCallIds.add(tool.id);
      });
    }
  }

  for (const message of messages) {
    if (
      message.role === 'tool' &&
      message.tool_call_id &&
      validToolCallIds.has(message.tool_call_id)
    ) {
      pairedToolOutputIds.add(message.tool_call_id);
    }
  }

  return { customToolCallIds, pairedToolOutputIds };
};
