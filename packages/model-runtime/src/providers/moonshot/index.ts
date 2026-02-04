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

// Shared constants and helpers
const MOONSHOT_SEARCH_TOOL = { function: { name: '$web_search' }, type: 'builtin_function' } as any;
const isKimiK25Model = (model: string) => model === 'kimi-k2.5';
const isEmptyContent = (content: any) =>
  content === '' || content === null || content === undefined;
const hasValidReasoning = (reasoning: any) => reasoning?.content && !reasoning?.signature;

const getK25Params = (isThinkingEnabled: boolean) => ({
  temperature: isThinkingEnabled ? 1 : 0.6,
  top_p: 0.95,
});

const appendSearchTool = <T>(tools: T[] | undefined, enabledSearch?: boolean): T[] | undefined => {
  if (!enabledSearch) return tools;
  return tools?.length ? [...tools, MOONSHOT_SEARCH_TOOL] : [MOONSHOT_SEARCH_TOOL];
};

// Anthropic format helpers
const buildThinkingBlock = (reasoning: any) =>
  hasValidReasoning(reasoning) ? { thinking: reasoning.content, type: 'thinking' as const } : null;

const toContentArray = (content: any) =>
  Array.isArray(content) ? content : [{ text: content, type: 'text' as const }];

const normalizeMessagesForAnthropic = (messages: ChatStreamPayload['messages']) =>
  messages.map((message: any) => {
    if (message.role !== 'assistant') return message;

    const { reasoning, ...rest } = message;
    const thinkingBlock = buildThinkingBlock(reasoning);

    if (isEmptyContent(message.content)) {
      const placeholder = { text: ' ', type: 'text' as const };
      return { ...rest, content: thinkingBlock ? [thinkingBlock] : [placeholder] };
    }

    if (!thinkingBlock) return rest;
    return { ...rest, content: [thinkingBlock, ...toContentArray(message.content)] };
  });

// OpenAI format helpers
const normalizeMessagesForOpenAI = (messages: ChatStreamPayload['messages']) =>
  messages.map((message: any) => {
    if (message.role !== 'assistant') return message;

    const { reasoning, ...rest } = message;
    const normalized = isEmptyContent(message.content) ? { ...rest, content: ' ' } : rest;

    if (hasValidReasoning(reasoning)) {
      return { ...normalized, reasoning_content: reasoning.content };
    }
    return normalized;
  });

/**
 * Build Moonshot Anthropic format payload with special handling for kimi-k2.5 thinking
 */
const buildMoonshotAnthropicPayload = async (
  payload: ChatStreamPayload,
): Promise<Anthropic.MessageCreateParams> => {
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
    messages: normalizeMessagesForAnthropic(payload.messages),
  });

  const tools = appendSearchTool(basePayload.tools, payload.enabledSearch);
  const basePayloadWithSearch = { ...basePayload, tools };

  if (!isKimiK25Model(payload.model)) return basePayloadWithSearch;

  const resolvedThinkingBudget = payload.thinking?.budget_tokens
    ? Math.min(payload.thinking.budget_tokens, resolvedMaxTokens - 1)
    : 1024;
  const thinkingParam =
    payload.thinking?.type === 'disabled'
      ? ({ type: 'disabled' } as const)
      : ({ budget_tokens: resolvedThinkingBudget, type: 'enabled' } as const);

  return {
    ...basePayloadWithSearch,
    ...getK25Params(thinkingParam.type === 'enabled'),
    thinking: thinkingParam,
  };
};

/**
 * Build Moonshot OpenAI format payload with temperature normalization
 */
const buildMoonshotOpenAIPayload = (
  payload: ChatStreamPayload,
): OpenAI.ChatCompletionCreateParamsStreaming => {
  const { enabledSearch, messages, model, temperature, thinking, tools, ...rest } = payload;

  const normalizedMessages = normalizeMessagesForOpenAI(messages);
  const moonshotTools = appendSearchTool(tools, enabledSearch);

  if (isKimiK25Model(model)) {
    const thinkingParam =
      thinking?.type === 'disabled' ? { type: 'disabled' } : { type: 'enabled' };

    return {
      ...rest,
      ...getK25Params(thinkingParam.type === 'enabled'),
      frequency_penalty: 0,
      messages: normalizedMessages,
      model,
      presence_penalty: 0,
      stream: payload.stream ?? true,
      thinking: thinkingParam,
      tools: moonshotTools?.length ? moonshotTools : undefined,
    } as any;
  }

  return {
    ...rest,
    messages: normalizedMessages,
    model,
    stream: payload.stream ?? true,
    // Moonshot temperature is normalized by dividing by 2
    temperature: temperature !== undefined ? temperature / 2 : undefined,
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
