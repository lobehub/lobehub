import type Anthropic from '@anthropic-ai/sdk';
import debug from 'debug';
import type { Pricing } from 'model-bank';

import type { GenerateObjectOptions, GenerateObjectPayload } from '../../types';
import { buildAnthropicMessages, buildAnthropicTools } from '../contextBuilders/anthropic';
import { buildAnthropicInitialUsage } from '../usageConverters/anthropic';
import { withUsageCost } from '../usageConverters/utils/withUsageCost';

const log = debug('lobe-model-runtime:anthropic:generate-object');

export interface AnthropicGenerateObjectConfig {
  maxTokens?: number;
  requestParams?: Pick<Anthropic.MessageCreateParamsNonStreaming, 'output_config' | 'thinking'>;
  schemaToolChoice?: 'any' | 'tool';
  schemaToolStrict?: boolean;
}

interface AnthropicToolUseLike {
  input?: unknown;
  name?: string;
  type?: string;
}

export interface AnthropicGenerateObjectResponse {
  content?: AnthropicToolUseLike[];
  usage?: Anthropic.Messages.Usage | null;
}

export const buildAnthropicGenerateObjectRequest = async (
  payload: GenerateObjectPayload,
  config?: AnthropicGenerateObjectConfig,
): Promise<{
  requestParams: Anthropic.MessageCreateParamsNonStreaming;
  schemaToolName?: string;
}> => {
  const { schema, messages, model, tools } = payload;

  log('generateObject called with model: %s', model);
  log('schema: %O', schema);
  log('messages count: %d', messages.length);

  // Convert messages to Anthropic format.
  // Filter out empty/whitespace-only system prompts — Anthropic API rejects them.
  const system_message = messages.find((m) => m.role === 'system')?.content;
  const systemPromptText =
    typeof system_message === 'string' && system_message.trim() ? system_message : undefined;
  const user_messages = messages.filter((m) => m.role !== 'system');
  const anthropicMessages = await buildAnthropicMessages(user_messages);

  log('converted %d messages to Anthropic format', anthropicMessages.length);

  const systemPrompts = systemPromptText
    ? [
        {
          text: systemPromptText,
          type: 'text' as const,
        },
      ]
    : undefined;

  let finalTools;
  let tool_choice: Anthropic.ToolChoiceAny | Anthropic.ToolChoiceTool;
  let schemaToolName: string | undefined;
  if (tools) {
    finalTools = buildAnthropicTools(tools);
    tool_choice = { type: 'any' };
  } else if (schema) {
    // Convert OpenAI-style schema to Anthropic tool format
    const tool: Anthropic.ToolUnion = {
      description:
        schema.description || 'Generate structured output according to the provided schema',
      input_schema: schema.schema as Anthropic.Tool.InputSchema,
      name: schema.name || 'structured_output',
      ...(config?.schemaToolStrict && schema.strict !== undefined ? { strict: schema.strict } : {}),
    };
    log('converted tool: %O', tool);

    finalTools = [tool];
    schemaToolName = tool.name;
    tool_choice =
      config?.schemaToolChoice === 'any' ? { type: 'any' } : { name: tool.name, type: 'tool' };
  } else {
    throw new Error('tools or schema is required');
  }

  return {
    requestParams: {
      max_tokens: config?.maxTokens ?? 64_000,
      messages: anthropicMessages,
      model,
      system: systemPrompts,
      ...config?.requestParams,
      tool_choice,
      tools: finalTools,
    },
    schemaToolName,
  };
};

export const emitAnthropicGenerateObjectUsage = async (
  response: AnthropicGenerateObjectResponse,
  options?: GenerateObjectOptions,
  pricing?: Pricing,
) => {
  const initialUsage = buildAnthropicInitialUsage(response.usage);
  if (initialUsage) {
    await options?.onUsage?.(withUsageCost(initialUsage, pricing));
  }
};

export const parseAnthropicGenerateObjectResponse = (
  response: AnthropicGenerateObjectResponse,
  schemaToolName?: string,
) => {
  const content = response.content ?? [];

  if (schemaToolName) {
    const toolUseBlock = content.find(
      (block) => block.type === 'tool_use' && block.name === schemaToolName,
    );

    if (!toolUseBlock || toolUseBlock.type !== 'tool_use') {
      log('no tool use found in response (expected tool: %s)', schemaToolName);
      return undefined;
    }

    log('extracted tool input: %O', toolUseBlock.input);
    return toolUseBlock.input;
  }

  return content
    .filter((block) => block.type === 'tool_use')
    .map((block) => ({ arguments: block.input, name: block.name }));
};

/**
 * Generate structured output using Anthropic Claude API with Function Calling
 */
export const createAnthropicGenerateObject = async (
  client: Anthropic,
  payload: GenerateObjectPayload,
  options?: GenerateObjectOptions,
  pricing?: Pricing,
  config?: AnthropicGenerateObjectConfig,
) => {
  const { requestParams, schemaToolName } = await buildAnthropicGenerateObjectRequest(
    payload,
    config,
  );

  try {
    log('calling Anthropic API with max_tokens: %d', requestParams.max_tokens);

    const response = await client.messages.create(requestParams, { signal: options?.signal });

    log('received response with %d content blocks', response.content.length);
    log('response: %O', response);

    await emitAnthropicGenerateObjectUsage(response, options, pricing);

    return parseAnthropicGenerateObjectResponse(response, schemaToolName);
  } catch (error) {
    log('generateObject error: %O', error);
    throw error;
  }
};
