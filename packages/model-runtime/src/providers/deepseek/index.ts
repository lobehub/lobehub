import type Anthropic from '@anthropic-ai/sdk';
import type { ChatModelCard } from '@lobechat/types';
import { ModelProvider } from 'model-bank';
import type OpenAI from 'openai';

import {
  buildDefaultAnthropicPayload,
  createAnthropicCompatibleParams,
  createAnthropicCompatibleRuntime,
} from '../../core/anthropicCompatibleFactory';
import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import type { CreateRouterRuntimeOptions } from '../../core/RouterRuntime';
import { createRouterRuntime } from '../../core/RouterRuntime';
import type { ChatStreamPayload } from '../../types';
import { getModelPropertyWithFallback } from '../../utils/getFallbackModelProperty';
import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';

export interface DeepSeekModelCard {
  id: string;
}

const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';
const DEFAULT_DEEPSEEK_ANTHROPIC_BASE_URL = 'https://api.deepseek.com/anthropic';
const DEEPSEEK_ANTHROPIC_BASE_URL_PATTERN = /\/anthropic\/?$/;
const DEEPSEEK_ANTHROPIC_MESSAGES_PATH_PATTERN = /\/v1\/messages\/?$/;

type DeepSeekSDKType = 'anthropic' | 'openai';

const isDeepSeekV4Model = (model: string) => model.startsWith('deepseek-v4');
const isEmptyContent = (content: unknown) =>
  content === '' || content === null || content === undefined;
const hasReasoningContent = (reasoning: any) => typeof reasoning?.content === 'string';

const buildThinkingBlock = (reasoning: any) =>
  hasReasoningContent(reasoning)
    ? { thinking: reasoning.content, type: 'thinking' as const }
    : undefined;

const toContentArray = (content: any) =>
  Array.isArray(content)
    ? content
    : [{ text: isEmptyContent(content) ? ' ' : content, type: 'text' as const }];

const normalizeDeepSeekAnthropicBaseURL = (baseURL?: string | null) =>
  baseURL?.replace(DEEPSEEK_ANTHROPIC_MESSAGES_PATH_PATTERN, '');

/**
 * `sdkType` explicitly selects the DeepSeek SDK wrapper for router-runtime channels.
 * Legacy baseURL suffix matching is only kept for existing configs that have not set it.
 */
const resolveDeepSeekSDKType = (sdkType: unknown): DeepSeekSDKType | undefined => {
  if (sdkType === undefined || sdkType === null || sdkType === '') return undefined;
  if (sdkType === 'anthropic' || sdkType === 'openai') return sdkType;

  throw new Error(`Unsupported DeepSeek sdkType: ${String(sdkType)}`);
};

const shouldEnableDeepSeekThinking = (payload: ChatStreamPayload) => {
  if (payload.model === 'deepseek-reasoner') return true;
  return isDeepSeekV4Model(payload.model) && payload.thinking?.type !== 'disabled';
};

const resolveDeepSeekThinking = (payload: ChatStreamPayload): ChatStreamPayload['thinking'] => {
  if (payload.model === 'deepseek-reasoner') {
    return {
      budget_tokens: payload.thinking?.budget_tokens ?? 1024,
      type: 'enabled',
    };
  }

  if (isDeepSeekV4Model(payload.model)) {
    if (payload.thinking?.type === 'disabled') {
      return {
        budget_tokens: 0,
        type: 'disabled',
      };
    }

    return {
      budget_tokens: payload.thinking?.budget_tokens ?? 1024,
      type: 'enabled',
    };
  }

  if (payload.thinking?.type === 'enabled' && payload.thinking.budget_tokens === undefined) {
    return {
      budget_tokens: 1024,
      type: 'enabled',
    };
  }

  return payload.thinking;
};

/**
 * DeepSeek's Anthropic-compatible API uses Anthropic content blocks for assistant
 * reasoning history. For V4 thinking mode we keep an explicit placeholder block
 * so follow-up tool-call turns preserve the same reasoning-history guarantee as
 * the OpenAI-compatible API.
 *
 * @see https://api-docs.deepseek.com/guides/anthropic_api
 * @see https://api-docs.deepseek.com/guides/thinking_mode#tool-calls
 */
const normalizeMessagesForAnthropic = (
  messages: ChatStreamPayload['messages'],
  forceThinking = false,
) =>
  messages.map((message: any) => {
    if (message.role !== 'assistant') return message;

    const { reasoning, ...rest } = message;
    const thinkingBlock = buildThinkingBlock(reasoning);
    const effectiveThinkingBlock =
      thinkingBlock || (forceThinking ? { thinking: ' ', type: 'thinking' as const } : undefined);

    if (!effectiveThinkingBlock) return rest;

    return {
      ...rest,
      content: [effectiveThinkingBlock, ...toContentArray(message.content)],
    };
  });

const buildDeepSeekAnthropicPayload = async (
  payload: ChatStreamPayload,
): Promise<Anthropic.MessageCreateParams> => {
  const resolvedThinking = resolveDeepSeekThinking(payload);
  const isThinkingDisabled = resolvedThinking?.type === 'disabled';
  const resolvedMaxTokens =
    payload.max_tokens ??
    (await getModelPropertyWithFallback<number | undefined>(
      payload.model,
      'maxOutput',
      ModelProvider.DeepSeek,
    )) ??
    (resolvedThinking?.type === 'enabled' ? 32_000 : 64_000);

  const basePayload = await buildDefaultAnthropicPayload({
    ...payload,
    effort: !isThinkingDisabled ? ((payload.effort ?? payload.reasoning_effort) as any) : undefined,
    max_tokens: resolvedMaxTokens,
    messages: normalizeMessagesForAnthropic(
      payload.messages,
      shouldEnableDeepSeekThinking(payload),
    ),
    thinking: isThinkingDisabled ? undefined : resolvedThinking,
  });

  return {
    ...basePayload,
    ...(basePayload.temperature !== undefined && payload.temperature !== undefined
      ? { temperature: payload.temperature }
      : {}),
    ...(isThinkingDisabled ? { thinking: { type: 'disabled' } } : {}),
  } as Anthropic.MessageCreateParams;
};

const buildDeepSeekOpenAIPayload = (
  payload: ChatStreamPayload,
): OpenAI.ChatCompletionCreateParamsStreaming => {
  // deepseek-v4-* defaults to thinking=enabled unless the caller explicitly
  // sets thinking.type === 'disabled'. In thinking mode the API rejects
  // (HTTP 400) follow-up turns that omit reasoning_content on assistant
  // messages with tool calls — see
  // https://api-docs.deepseek.com/guides/thinking_mode#tool-calls
  const isV4Model = typeof payload.model === 'string' && isDeepSeekV4Model(payload.model);
  const thinkingExplicitlyDisabled = payload.thinking?.type === 'disabled';
  const shouldForceAssistantReasoningContent =
    payload.model === 'deepseek-reasoner' || (isV4Model && !thinkingExplicitlyDisabled);

  // Transform reasoning object to reasoning_content string for multi-turn conversations
  const messages = payload.messages.map((message: any) => {
    const { reasoning, ...rest } = message;

    const reasoningContent =
      typeof rest.reasoning_content === 'string'
        ? rest.reasoning_content
        : typeof reasoning?.content === 'string'
          ? reasoning.content
          : undefined;

    // DeepSeek thinking mode with tool calls requires assistant history
    // messages to carry reasoning_content, or the API returns a 400.
    if (message.role === 'assistant' && shouldForceAssistantReasoningContent) {
      return {
        ...rest,
        reasoning_content: reasoningContent ?? '',
      };
    }

    if (reasoningContent !== undefined) {
      return {
        ...rest,
        reasoning_content: reasoningContent,
      };
    }

    return rest;
  });

  // DeepSeek rejects `reasoning_effort` when thinking is explicitly disabled.
  const { reasoning_effort, ...restPayload } = payload;

  return {
    ...restPayload,
    messages,
    ...(!thinkingExplicitlyDisabled && reasoning_effort && { reasoning_effort }),
    stream: payload.stream ?? true,
  } as OpenAI.ChatCompletionCreateParamsStreaming;
};

const fetchDeepSeekModels = async ({
  client,
}: {
  client: OpenAI | unknown;
}): Promise<ChatModelCard[]> => {
  const modelClient = client as {
    models?: { list?: () => Promise<{ data?: DeepSeekModelCard[] }> };
  };

  if (modelClient.models?.list) {
    const modelsPage = await modelClient.models.list();
    const modelList = modelsPage.data || [];

    return processModelList(modelList, MODEL_LIST_CONFIGS.deepseek, 'deepseek');
  }

  const { deepseek } = await import('model-bank');

  return processModelList(deepseek, MODEL_LIST_CONFIGS.deepseek, 'deepseek');
};

export const anthropicParams = createAnthropicCompatibleParams({
  baseURL: DEFAULT_DEEPSEEK_ANTHROPIC_BASE_URL,
  chatCompletion: {
    handlePayload: buildDeepSeekAnthropicPayload,
  },
  customClient: {},
  debug: {
    chatCompletion: () => process.env.DEBUG_DEEPSEEK_CHAT_COMPLETION === '1',
  },
  provider: ModelProvider.DeepSeek,
});

export const LobeDeepSeekAnthropicAI = createAnthropicCompatibleRuntime(anthropicParams);

export const openAIParams = {
  baseURL: DEFAULT_DEEPSEEK_BASE_URL,
  chatCompletion: {
    handlePayload: buildDeepSeekOpenAIPayload,
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_DEEPSEEK_CHAT_COMPLETION === '1',
  },
  // Deepseek don't support json format well
  // use Tools calling to simulate
  generateObject: {
    useToolsCalling: true,
  },
  models: fetchDeepSeekModels,
  provider: ModelProvider.DeepSeek,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeDeepSeekOpenAI = createOpenAICompatibleRuntime(openAIParams);

const createOpenAIRouter = (baseURLPattern?: RegExp) => ({
  apiType: 'deepseek' as const,
  ...(baseURLPattern ? { baseURLPattern } : {}),
  id: 'openai-compatible',
  options: { remark: 'openai-compatible' },
  runtime: LobeDeepSeekOpenAI,
});

const createAnthropicRouter = ({
  baseURL,
  baseURLPattern,
}: {
  baseURL?: string;
  baseURLPattern?: RegExp;
} = {}) => ({
  apiType: 'deepseek' as const,
  ...(baseURLPattern ? { baseURLPattern } : {}),
  id: 'anthropic-compatible',
  options: {
    ...(baseURL ? { baseURL } : {}),
    remark: 'anthropic-compatible',
  },
  runtime: LobeDeepSeekAnthropicAI,
});

export const params: CreateRouterRuntimeOptions = {
  id: ModelProvider.DeepSeek,
  models: fetchDeepSeekModels,
  routers: (options) => {
    const sdkType = resolveDeepSeekSDKType(options.sdkType);

    if (sdkType === 'anthropic') {
      return [
        createAnthropicRouter({
          baseURL: normalizeDeepSeekAnthropicBaseURL(options.baseURL),
        }),
      ];
    }

    if (sdkType === 'openai') {
      return [createOpenAIRouter()];
    }

    return [
      createOpenAIRouter(/^(?!.*\/anthropic\/?$).+$/),
      createAnthropicRouter({ baseURLPattern: DEEPSEEK_ANTHROPIC_BASE_URL_PATTERN }),
    ];
  },
};

export const LobeDeepSeekAI = createRouterRuntime(params);
