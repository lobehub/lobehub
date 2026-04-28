import type Anthropic from '@anthropic-ai/sdk';
import type { ChatModelCard } from '@lobechat/types';
import { ModelProvider } from 'model-bank';
import type OpenAI from 'openai';

import {
  buildDefaultAnthropicPayload,
  createAnthropicCompatibleParams,
  createAnthropicCompatibleRuntime,
} from '../../core/anthropicCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import type { CreateRouterRuntimeOptions } from '../../core/RouterRuntime';
import { createRouterRuntime } from '../../core/RouterRuntime';
import type { ChatStreamPayload } from '../../types';
import { getModelPropertyWithFallback } from '../../utils/getFallbackModelProperty';
import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';

export interface MoonshotModelCard {
  context_length?: number;
  id: string;
  supports_image_in?: boolean;
}

const DEFAULT_MOONSHOT_BASE_URL = 'https://api.moonshot.cn/v1';
const DEFAULT_MOONSHOT_ANTHROPIC_BASE_URL = 'https://api.moonshot.cn/anthropic';

// Shared constants and helpers
const MOONSHOT_SEARCH_TOOL = { function: { name: '$web_search' }, type: 'builtin_function' } as any;
/**
 * Matches kimi-k2.N models (K2.5, K2.6, ...) that expose a thinking toggle via
 * `payload.thinking.type`. Assumes every future kimi-k2.N release keeps the same
 * toggle contract and param constraints; if Moonshot diverges, introduce an
 * explicit allowlist instead of widening this prefix.
 */
const isKimiThinkingToggleModel = (model: string) => model.startsWith('kimi-k2.');
const isKimiNativeThinkingModel = (model: string) => model.startsWith('kimi-k2-thinking');
const isEmptyContent = (content: any) =>
  content === '' || content === null || content === undefined;
const hasValidReasoning = (reasoning: any) => reasoning?.content && !reasoning?.signature;

const getKimiThinkingToggleParams = (isThinkingEnabled: boolean) => ({
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

/**
 * Normalize assistant messages for Anthropic format.
 * When forceThinking is true (kimi-k2.x family with thinking enabled), every assistant
 * message must carry a thinking block, otherwise Moonshot rejects with:
 * "thinking is enabled but reasoning_content is missing in assistant tool call message"
 */
const normalizeMessagesForAnthropic = (
  messages: ChatStreamPayload['messages'],
  forceThinking = false,
) =>
  messages.map((message: any) => {
    if (message.role !== 'assistant') return message;

    const { reasoning, ...rest } = message;
    const thinkingBlock = buildThinkingBlock(reasoning);
    const effectiveBlock =
      thinkingBlock || (forceThinking ? { thinking: ' ', type: 'thinking' as const } : null);

    if (isEmptyContent(message.content)) {
      const placeholder = { text: ' ', type: 'text' as const };
      return { ...rest, content: effectiveBlock ? [effectiveBlock, placeholder] : [placeholder] };
    }

    if (!effectiveBlock) return rest;
    return { ...rest, content: [effectiveBlock, ...toContentArray(message.content)] };
  });

/**
 * Normalize assistant messages for OpenAI format.
 * When forceReasoning is true (kimi-k2.x family with thinking enabled), every assistant
 * message must carry reasoning_content (even as empty string), similar to DeepSeek.
 */
const normalizeMessagesForOpenAI = (
  messages: ChatStreamPayload['messages'],
  forceReasoning = false,
) =>
  messages.map((message: any) => {
    if (message.role !== 'assistant') return message;

    const { reasoning, ...rest } = message;
    const normalized = isEmptyContent(message.content) ? { ...rest, content: ' ' } : rest;
    const reasoningContent = hasValidReasoning(reasoning) ? reasoning.content : undefined;

    if (forceReasoning) {
      return { ...normalized, reasoning_content: reasoningContent ?? '' };
    }
    if (reasoningContent !== undefined) {
      return { ...normalized, reasoning_content: reasoningContent };
    }
    return normalized;
  });

/**
 * Build Moonshot Anthropic format payload with special handling for kimi-k2.x thinking toggle
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

  const isK2Family = isKimiThinkingToggleModel(payload.model);
  const isNativeThinking = isKimiNativeThinkingModel(payload.model);
  const isThinkingEnabled =
    isNativeThinking || (isK2Family && payload.thinking?.type !== 'disabled');

  const basePayload = await buildDefaultAnthropicPayload({
    ...payload,
    enabledSearch: false,
    max_tokens: resolvedMaxTokens,
    messages: normalizeMessagesForAnthropic(payload.messages, isThinkingEnabled),
  });

  const tools = appendSearchTool(basePayload.tools, payload.enabledSearch);
  const basePayloadWithSearch = { ...basePayload, tools };

  if (!isK2Family && !isNativeThinking) return basePayloadWithSearch;

  const resolvedThinkingBudget = payload.thinking?.budget_tokens
    ? Math.min(payload.thinking.budget_tokens, resolvedMaxTokens - 1)
    : 1024;
  const thinkingParam =
    isNativeThinking || payload.thinking?.type !== 'disabled'
      ? ({ budget_tokens: resolvedThinkingBudget, type: 'enabled' } as const)
      : ({ type: 'disabled' } as const);

  return {
    ...basePayloadWithSearch,
    ...getKimiThinkingToggleParams(thinkingParam.type === 'enabled'),
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

  const isK2Family = isKimiThinkingToggleModel(model);
  const isNativeThinking = isKimiNativeThinkingModel(model);
  const isThinkingEnabled = isNativeThinking || (isK2Family && thinking?.type !== 'disabled');
  const normalizedMessages = normalizeMessagesForOpenAI(messages, isThinkingEnabled);
  const moonshotTools = appendSearchTool(tools, enabledSearch);

  if (isK2Family || isNativeThinking) {
    const thinkingParam =
      isNativeThinking || thinking?.type !== 'disabled'
        ? { type: 'enabled' }
        : { type: 'disabled' };

    return {
      ...rest,
      ...getKimiThinkingToggleParams(thinkingParam.type === 'enabled'),
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

    const processedList = modelList.map((model) => ({
      contextWindowTokens: model.context_length,
      id: model.id,
      vision: model.supports_image_in,
    }));

    return processModelList(processedList, MODEL_LIST_CONFIGS.moonshot, 'moonshot');
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
