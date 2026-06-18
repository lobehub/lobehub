import type Anthropic from '@anthropic-ai/sdk';
import { minimax as minimaxChatModels, ModelProvider } from 'model-bank';

import {
  buildDefaultAnthropicPayload,
  createAnthropicCompatibleParams,
  createAnthropicCompatibleRuntime,
} from '../../core/anthropicCompatibleFactory';
import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { resolveParameters } from '../../core/parameterResolver';
import type { CreateRouterRuntimeOptions } from '../../core/RouterRuntime';
import { createRouterRuntime } from '../../core/RouterRuntime';
import type { ChatStreamPayload } from '../../types';
import { getModelPropertyWithFallback } from '../../utils/getFallbackModelProperty';
import { resolveSafeMaxTokens } from '../../utils/resolveSafeMaxTokens';
import { createMiniMaxImage } from './createImage';
import { createMiniMaxVideo } from './createVideo';

const DEFAULT_MINIMAX_BASE_URL = 'https://api.minimaxi.com/v1';
const DEFAULT_MINIMAX_ANTHROPIC_BASE_URL = 'https://api.minimax.io/anthropic';
const MINIMAX_ANTHROPIC_BASE_URL_PATTERN = /\/anthropic\/?$/;
const MINIMAX_ANTHROPIC_MESSAGES_PATH_PATTERN = /\/v1\/messages\/?$/;

const isMiniMaxM3Model = (model: string) => model.toLowerCase() === 'minimax-m3';

type MiniMaxSDKType = 'anthropic' | 'openai';

const isEmptyContent = (content: unknown) =>
  content === '' || content === null || content === undefined;

const hasReasoningContent = (reasoning: any) => typeof reasoning?.content === 'string';

const normalizeMiniMaxAnthropicBaseURL = (baseURL?: string | null) =>
  baseURL?.replace(MINIMAX_ANTHROPIC_MESSAGES_PATH_PATTERN, '');

const resolveMiniMaxSDKType = (sdkType: unknown): MiniMaxSDKType | undefined => {
  if (sdkType === undefined || sdkType === null || sdkType === '') return undefined;
  if (sdkType === 'anthropic' || sdkType === 'openai') return sdkType;

  throw new Error(`Unsupported MiniMax sdkType: ${String(sdkType)}`);
};

const buildThinkingBlock = (reasoning: any) =>
  hasReasoningContent(reasoning)
    ? { thinking: reasoning.content, type: 'thinking' as const }
    : undefined;

const toContentArray = (content: any) =>
  Array.isArray(content)
    ? content
    : [{ text: isEmptyContent(content) ? ' ' : content, type: 'text' as const }];

const normalizeMessagesForAnthropic = (messages: ChatStreamPayload['messages']) =>
  messages.map((message: any) => {
    if (message.role !== 'assistant') return message;

    const { reasoning, ...rest } = message;
    const thinkingBlock = buildThinkingBlock(reasoning);

    if (!thinkingBlock) return rest;

    return {
      ...rest,
      content: [thinkingBlock, ...toContentArray(message.content)],
    };
  });

export const buildMiniMaxAnthropicPayload = async (
  payload: ChatStreamPayload,
): Promise<Anthropic.MessageCreateParams> => {
  const resolvedMaxTokens =
    payload.max_tokens ??
    (await getModelPropertyWithFallback<number | undefined>(
      payload.model,
      'maxOutput',
      ModelProvider.Minimax,
    )) ??
    64_000;

  const basePayload = await buildDefaultAnthropicPayload({
    ...payload,
    enabledSearch: false,
    max_tokens: resolvedMaxTokens,
    messages: normalizeMessagesForAnthropic(payload.messages),
  });
  const { temperature, top_p, ...restPayload } = basePayload;
  const resolvedParams = resolveParameters(
    {
      temperature: payload.temperature,
      top_p: payload.top_p,
    },
    {
      normalizeTemperature: true,
      topPRange: { max: 1, min: 0.01 },
    },
  );
  const finalTemperature =
    resolvedParams.temperature !== undefined && resolvedParams.temperature <= 0
      ? undefined
      : resolvedParams.temperature;

  return {
    ...restPayload,
    ...(finalTemperature !== undefined ? { temperature: finalTemperature } : {}),
    ...(resolvedParams.top_p !== undefined ? { top_p: resolvedParams.top_p } : {}),
  };
};

export const buildMiniMaxOpenAIPayload = (payload: ChatStreamPayload) => {
  const { enabledSearch, max_tokens, messages, temperature, thinking, top_p, ...params } = payload;

  const isM3 = isMiniMaxM3Model(payload.model);

  // Interleaved thinking
  const processedMessages = messages.map((message: any) => {
    if (message.role === 'assistant' && message.reasoning) {
      // Only process historical reasoning content without a signature
      if (!message.reasoning.signature && message.reasoning.content) {
        const { reasoning, ...messageWithoutReasoning } = message;
        return {
          ...messageWithoutReasoning,
          reasoning_details: [
            {
              format: 'MiniMax-response-v1',
              id: 'reasoning-text-0',
              index: 0,
              text: reasoning.content,
              type: 'reasoning.text',
            },
          ],
        };
      }

      // If there is a signature or no content, remove the reasoning field
      // eslint-disable-next-line unused-imports/no-unused-vars
      const { reasoning, ...messageWithoutReasoning } = message;
      return messageWithoutReasoning;
    }
    return message;
  });

  // MiniMax API enforces `input_tokens + max_tokens <= context_window`,
  // so we must derive max_tokens dynamically from the actual input size
  // when the caller did not specify one. Estimate against the sanitized
  // messages (with stripped reasoning) — that's what we actually send.
  const safeMaxTokens = resolveSafeMaxTokens(
    { ...payload, messages: processedMessages },
    minimaxChatModels,
  );

  // Resolve parameters with constraints
  const resolvedParams = resolveParameters(
    {
      max_tokens: safeMaxTokens,
      temperature,
      top_p,
    },
    {
      normalizeTemperature: !isM3,
      temperatureRange: isM3 ? { max: 2, min: 0 } : undefined,
      topPRange: isM3 ? { max: 1, min: 0 } : { max: 1, min: 0.01 },
    },
  );

  // Minimax doesn't support temperature <= 0
  const finalTemperature =
    !isM3 && resolvedParams.temperature !== undefined && resolvedParams.temperature <= 0
      ? undefined
      : resolvedParams.temperature;

  const finalThinking = isM3
    ? thinking?.type === 'disabled'
      ? { thinking: { type: 'disabled' } }
      : thinking?.type === 'enabled' || thinking?.type === 'adaptive'
        ? { thinking: { type: 'adaptive' } }
        : {}
    : thinking
      ? { thinking }
      : {};

  const outputLimitParam = isM3
    ? { max_completion_tokens: resolvedParams.max_tokens }
    : { max_tokens: resolvedParams.max_tokens };

  return {
    ...params,
    ...outputLimitParam,
    messages: processedMessages,
    reasoning_split: true,
    temperature: finalTemperature,
    ...finalThinking,
    top_p: resolvedParams.top_p,
  } as any;
};

export const openAIParams = {
  baseURL: DEFAULT_MINIMAX_BASE_URL,
  chatCompletion: {
    handlePayload: buildMiniMaxOpenAIPayload,
    handleTransformResponseToStream: (data) => {
      const choices = data.choices || [];
      const first = choices[0];
      const message = first?.message as any;
      const reasoningText = Array.isArray(message?.reasoning_details)
        ? message.reasoning_details
            .filter((detail: any) => detail.text)
            .map((detail: any) => detail.text)
            .join('')
        : undefined;

      return new ReadableStream({
        start(controller) {
          if (reasoningText) {
            controller.enqueue({
              choices: [
                {
                  delta: {
                    content: null,
                    reasoning_details: message.reasoning_details,
                    role: 'assistant',
                  } as any,
                  finish_reason: null,
                  index: first?.index ?? 0,
                  logprobs: first?.logprobs ?? null,
                },
              ],
              created: data.created,
              id: data.id,
              model: data.model,
              object: 'chat.completion.chunk',
            });
          }

          controller.enqueue({
            choices: choices.map((choice: any) => ({
              delta: {
                content: choice.message.content,
                role: choice.message.role,
                tool_calls: choice.message.tool_calls?.map((tool: any, index: number) => ({
                  function: tool.function,
                  id: tool.id,
                  index,
                  type: tool.type,
                })),
              },
              finish_reason: null,
              index: choice.index,
              logprobs: choice.logprobs,
            })),
            created: data.created,
            id: data.id,
            model: data.model,
            object: 'chat.completion.chunk',
          });

          if (data.usage) {
            controller.enqueue({
              choices: [],
              created: data.created,
              id: data.id,
              model: data.model,
              object: 'chat.completion.chunk',
              usage: data.usage,
            });
          }

          controller.enqueue({
            choices: choices.map((choice: any) => ({
              delta: {
                content: null,
                role: choice.message.role,
              },
              finish_reason: choice.finish_reason,
              index: choice.index,
              logprobs: choice.logprobs,
            })),
            created: data.created,
            id: data.id,
            model: data.model,
            object: 'chat.completion.chunk',
          });
          controller.close();
        },
      });
    },
  },
  createImage: createMiniMaxImage,
  createVideo: createMiniMaxVideo,
  debug: {
    chatCompletion: () => process.env.DEBUG_MINIMAX_CHAT_COMPLETION === '1',
  },
  handlePollVideoStatus: async (inferenceId: string, options: any) => {
    const { pollMiniMaxVideoStatus } = await import('./createVideo');
    return pollMiniMaxVideoStatus(inferenceId, {
      apiKey: options.apiKey,
      baseURL: options.baseURL || '',
    });
  },
  provider: ModelProvider.Minimax,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeMinimaxOpenAI = createOpenAICompatibleRuntime(openAIParams);

export const anthropicParams = createAnthropicCompatibleParams({
  baseURL: DEFAULT_MINIMAX_ANTHROPIC_BASE_URL,
  chatCompletion: {
    handlePayload: buildMiniMaxAnthropicPayload,
  },
  customClient: {},
  debug: {
    chatCompletion: () => process.env.DEBUG_MINIMAX_CHAT_COMPLETION === '1',
  },
  provider: ModelProvider.Minimax,
});

export const LobeMinimaxAnthropicAI = createAnthropicCompatibleRuntime(anthropicParams);

const createAnthropicRouter = ({
  baseURL,
  baseURLPattern,
}: {
  baseURL?: string;
  baseURLPattern?: RegExp;
} = {}) => ({
  apiType: 'anthropic' as const,
  ...(baseURLPattern ? { baseURLPattern } : {}),
  id: 'anthropic-compatible',
  options: {
    ...(baseURL ? { baseURL } : {}),
    remark: 'anthropic-compatible',
  },
  runtime: LobeMinimaxAnthropicAI,
});

const createOpenAIRouter = () => ({
  apiType: 'openai' as const,
  id: 'openai-compatible',
  options: { remark: 'openai-compatible' },
  runtime: LobeMinimaxOpenAI,
});

export const params: CreateRouterRuntimeOptions = {
  id: ModelProvider.Minimax,
  routers: (options) => {
    const sdkType = resolveMiniMaxSDKType(options.sdkType);

    if (sdkType === 'anthropic') {
      return [
        createAnthropicRouter({
          baseURL: normalizeMiniMaxAnthropicBaseURL(options.baseURL),
        }),
      ];
    }

    if (sdkType === 'openai') {
      return [createOpenAIRouter()];
    }

    return [
      createAnthropicRouter({ baseURLPattern: MINIMAX_ANTHROPIC_BASE_URL_PATTERN }),
      createOpenAIRouter(),
    ];
  },
};

export const LobeMinimaxAI = createRouterRuntime(params);
