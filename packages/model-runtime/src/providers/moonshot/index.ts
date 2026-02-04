import type Anthropic from '@anthropic-ai/sdk';
import type { ChatModelCard } from '@lobechat/types';
import { ModelProvider } from 'model-bank';
import OpenAI from 'openai';

import { CreateRouterRuntimeOptions, createRouterRuntime } from '../../core/RouterRuntime';
import {
  buildDefaultAnthropicPayload,
  createAnthropicCompatibleParams,
  createAnthropicCompatibleRuntime,
} from '../../core/anthropicCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { ChatStreamPayload } from '../../types';
import { getModelPropertyWithFallback } from '../../utils/getFallbackModelProperty';
import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';

export interface MoonshotModelCard {
  id: string;
}

const DEFAULT_MOONSHOT_BASE_URL = 'https://api.moonshot.ai/v1';
const DEFAULT_MOONSHOT_ANTHROPIC_BASE_URL = 'https://api.moonshot.ai/anthropic';

/**
 * Normalize empty assistant messages by adding a space placeholder (#8418)
 */
const normalizeMoonshotMessages = (messages: ChatStreamPayload['messages']) =>
  messages.map((message) => {
    if (message.role !== 'assistant') return message;
    if (message.content !== '' && message.content !== null && message.content !== undefined)
      return message;

    return { ...message, content: [{ text: ' ', type: 'text' as const }] };
  });

/**
 * Append Moonshot web search tool for builtin search capability
 */
const appendMoonshotSearchTool = (
  tools: Anthropic.MessageCreateParams['tools'] | undefined,
  enabledSearch?: boolean,
) => {
  if (!enabledSearch) return tools;

  const moonshotSearchTool = {
    function: { name: '$web_search' },
    type: 'builtin_function',
  } as any;

  return tools?.length ? [...tools, moonshotSearchTool] : [moonshotSearchTool];
};

/**
 * Build Moonshot Anthropic format payload with special handling for kimi-k2.5 thinking
 */
const buildMoonshotAnthropicPayload = async (
  payload: ChatStreamPayload,
): Promise<Anthropic.MessageCreateParams> => {
  const normalizedMessages = normalizeMoonshotMessages(payload.messages);
  const resolvedMaxTokens =
    payload.max_tokens ??
    (await getModelPropertyWithFallback<number | undefined>(
      payload.model,
      'maxOutput',
      ModelProvider.Moonshot,
    )) ??
    8192;

  const basePayload = await buildDefaultAnthropicPayload({
    ...payload,
    enabledSearch: false,
    max_tokens: resolvedMaxTokens,
    messages: normalizedMessages,
  });

  const tools = appendMoonshotSearchTool(basePayload.tools, payload.enabledSearch);
  const basePayloadWithSearch = { ...basePayload, tools };

  const isK25Model = payload.model === 'kimi-k2.5';
  if (!isK25Model) return basePayloadWithSearch;

  const resolvedThinkingBudget = payload.thinking?.budget_tokens
    ? Math.min(payload.thinking.budget_tokens, resolvedMaxTokens - 1)
    : 1024;
  const thinkingParam =
    payload.thinking?.type === 'disabled'
      ? ({ type: 'disabled' } as const)
      : ({ budget_tokens: resolvedThinkingBudget, type: 'enabled' } as const);
  const isThinkingEnabled = thinkingParam.type === 'enabled';

  return {
    ...basePayloadWithSearch,
    temperature: isThinkingEnabled ? 1 : 0.6,
    thinking: thinkingParam,
    top_p: 0.95,
  };
};

/**
 * Build Moonshot OpenAI format payload with temperature normalization
 */
const buildMoonshotOpenAIPayload = (
  payload: ChatStreamPayload,
): OpenAI.ChatCompletionCreateParamsStreaming => {
  const { enabledSearch, messages, model, temperature, thinking, tools, ...rest } = payload;

  // Normalize messages: handle empty assistant messages and interleaved thinking
  const normalizedMessages = messages.map((message: any) => {
    let normalizedMessage = message;

    // Add a space for empty assistant messages (#8418)
    if (
      message.role === 'assistant' &&
      (message.content === '' || message.content === null || message.content === undefined)
    ) {
      normalizedMessage = { ...normalizedMessage, content: ' ' };
    }

    // Interleaved thinking: convert reasoning to reasoning_content
    if (message.role === 'assistant' && message.reasoning) {
      const { reasoning, ...messageWithoutReasoning } = normalizedMessage;
      return {
        ...messageWithoutReasoning,
        ...(!reasoning.signature && reasoning.content
          ? { reasoning_content: reasoning.content }
          : {}),
      };
    }
    return normalizedMessage;
  });

  const moonshotTools = enabledSearch
    ? [
        ...(tools || []),
        {
          function: { name: '$web_search' },
          type: 'builtin_function',
        },
      ]
    : tools;

  const isK25Model = model === 'kimi-k2.5';

  if (isK25Model) {
    const thinkingParam =
      thinking?.type === 'disabled' ? { type: 'disabled' } : { type: 'enabled' };
    const isThinkingEnabled = thinkingParam.type === 'enabled';

    return {
      ...rest,
      frequency_penalty: 0,
      messages: normalizedMessages,
      model,
      presence_penalty: 0,
      stream: payload.stream ?? true,
      temperature: isThinkingEnabled ? 1 : 0.6,
      thinking: thinkingParam,
      tools: moonshotTools?.length ? moonshotTools : undefined,
      top_p: 0.95,
    } as any;
  }

  // Moonshot temperature is normalized by dividing by 2
  const normalizedTemperature = temperature !== undefined ? temperature / 2 : undefined;

  return {
    ...rest,
    messages: normalizedMessages,
    model,
    stream: payload.stream ?? true,
    temperature: normalizedTemperature,
    tools: moonshotTools?.length ? moonshotTools : undefined,
  } as OpenAI.ChatCompletionCreateParamsStreaming;
};

/**
 * Fetch Moonshot models from the API using OpenAI client
 */
const fetchMoonshotModels = async ({ client }: { client: OpenAI }): Promise<ChatModelCard[]> => {
  try {
    const modelsPage = (await client.models.list()) as any;
    const modelList: MoonshotModelCard[] = modelsPage.data || [];

    return processModelList(modelList, MODEL_LIST_CONFIGS.moonshot, 'moonshot');
  } catch (error) {
    console.warn('Failed to fetch Moonshot models:', error);
    return [];
  }
};

/**
 * Moonshot Anthropic format runtime
 */
export const anthropicParams = createAnthropicCompatibleParams({
  baseURL: DEFAULT_MOONSHOT_ANTHROPIC_BASE_URL,
  chatCompletion: {
    handlePayload: buildMoonshotAnthropicPayload,
  },
  customClient: {},
  debug: {
    chatCompletion: () => process.env.DEBUG_MOONSHOT_CHAT_COMPLETION === '1',
  },
  provider: ModelProvider.Moonshot,
});

export const LobeMoonshotAnthropicAI = createAnthropicCompatibleRuntime(anthropicParams);

/**
 * Moonshot OpenAI format runtime
 */
export const LobeMoonshotOpenAI = createOpenAICompatibleRuntime({
  baseURL: DEFAULT_MOONSHOT_BASE_URL,
  chatCompletion: {
    forceImageBase64: true,
    handlePayload: buildMoonshotOpenAIPayload,
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_MOONSHOT_CHAT_COMPLETION === '1',
  },
  provider: ModelProvider.Moonshot,
});

/**
 * RouterRuntime configuration for Moonshot
 * Routes to Anthropic format for /anthropic URLs, otherwise uses OpenAI format
 */
export const params: CreateRouterRuntimeOptions = {
  id: ModelProvider.Moonshot,
  models: fetchMoonshotModels,
  routers: [
    {
      apiType: 'anthropic',
      baseURLPattern: /\/anthropic\/?$/,
      options: {},
      runtime: LobeMoonshotAnthropicAI,
    },
    {
      apiType: 'openai',
      options: {},
      runtime: LobeMoonshotOpenAI,
    },
  ],
};

export const LobeMoonshotAI = createRouterRuntime(params);
