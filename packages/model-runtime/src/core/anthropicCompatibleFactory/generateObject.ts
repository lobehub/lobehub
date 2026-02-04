import type Anthropic from '@anthropic-ai/sdk';
import debug from 'debug';

import { buildAnthropicMessages, buildAnthropicTools } from '../contextBuilders/anthropic';
import { GenerateObjectOptions, GenerateObjectPayload } from '../../types';

const log = debug('lobe-model-runtime:anthropic:generate-object');

/**
 * Generate structured output using Anthropic Claude API with Function Calling
 */
export const createAnthropicGenerateObject = async (
  client: Anthropic,
  payload: GenerateObjectPayload,
  options?: GenerateObjectOptions,
) => {
  const { schema, messages, model, tools } = payload;

  log('generateObject called with model: %s', model);
  log('schema: %O', schema);
  log('messages count: %d', messages.length);

  // Convert messages to Anthropic format
  const system_message = messages.find((m) => m.role === 'system')?.content;
  const user_messages = messages.filter((m) => m.role !== 'system');
  const anthropicMessages = await buildAnthropicMessages(user_messages);

  log('converted %d messages to Anthropic format', anthropicMessages.length);

  const systemPrompts = system_message
    ? [
        {
          text: system_message,
          type: 'text' as const,
        },
      ]
    : undefined;

  let finalTools;
  let tool_choice: Anthropic.ToolChoiceAny | Anthropic.ToolChoiceTool;
  if (tools) {
    finalTools = buildAnthropicTools(tools);
    tool_choice = { type: 'any' };
  } else if (schema) {
    // Convert OpenAI-style schema to Anthropic tool format
    const tool: Anthropic.ToolUnion = {
      description:
        schema.description || 'Generate structured output according to the provided schema',
      input_schema: schema.schema as any,
      name: schema.name || 'structured_output',
    };
    log('converted tool: %O', tool);

    finalTools = [tool];
    tool_choice = { name: tool.name, type: 'tool' };
  } else {
    throw new Error('tools or schema is required');
  }

  try {
    log('calling Anthropic API with max_tokens: %d', 8192);

    const response = await client.messages.create(
      {
        max_tokens: 8192,
        messages: anthropicMessages,
        model,
        system: systemPrompts,
        tool_choice: tool_choice,
        tools: finalTools,
      },
      { signal: options?.signal },
    );

    log('received response with %d content blocks', response.content.length);
    log('response: %O', response);

    // Extract the tool use result
    if (tool_choice.type === 'tool') {
      const toolUseBlock = response.content.find(
        (block) => block.type === 'tool_use' && block.name === tool_choice.name,
      );

      if (!toolUseBlock || toolUseBlock.type !== 'tool_use') {
        log('no tool use found in response (expected tool: %s)', tool_choice.name);
        return undefined;
      }

      log('extracted tool input: %O', toolUseBlock.input);
      return toolUseBlock.input;
    }

    return response.content
      .filter((block) => block.type === 'tool_use')
      .map((block) => ({ arguments: block.input, name: block.name }));
  } catch (error) {
    log('generateObject error: %O', error);
    throw error;
  }
};
