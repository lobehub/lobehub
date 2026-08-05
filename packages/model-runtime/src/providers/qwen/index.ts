import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { resolveParameters } from '../../core/parameterResolver';
import { QwenAIStream } from '../../core/streams';
import { processMultiProviderModelList } from '../../utils/modelParse';
import { createQwenImage } from './createImage';
import { createQwenVideo } from './createVideo';
import {
  isQwen38MaxModel,
  isThinkingForcedQwenModel,
  normalizeQwen38ReasoningEffort,
} from './modelId';

export interface QwenModelCard {
  id: string;
}

/*
  QwenLegacyModels: A set of legacy Qwen models that do not support presence_penalty.
  Currently, presence_penalty is only supported on Qwen commercial models and open-source models starting from Qwen 1.5 and later.
*/
export const QwenLegacyModels = new Set([
  'qwen-72b-chat',
  'qwen-14b-chat',
  'qwen-7b-chat',
  'qwen-1.8b-chat',
  'qwen-1.8b-longcontext-chat',
]);

export const params = {
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const {
        model,
        presence_penalty,
        reasoning_effort,
        temperature,
        thinking,
        top_p,
        enabledSearch,
        preserveThinking,
        ...rest
      } = payload;
      const isDeepSeekV4Model = model.startsWith('deepseek-v4');
      const isQwen38Max = isQwen38MaxModel(model);
      const thinkingExplicitlyDisabled = thinking?.type === 'disabled';
      const qwen38ReasoningEffort = isQwen38Max
        ? normalizeQwen38ReasoningEffort(reasoning_effort)
        : undefined;

      // Resolve parameters with model-specific constraints
      const resolvedParams = resolveParameters(
        { presence_penalty, temperature, top_p },
        {
          normalizeTemperature: false,
          presencePenaltyRange: QwenLegacyModels.has(model) ? undefined : { max: 2, min: -2 },
          temperatureRange: {
            max: 2,
            min: isQwen38Max ? 0.6 : 0,
          },
          topPRange:
            model.startsWith('qvq') || model.startsWith('qwen-vl')
              ? { max: 1, min: 0 }
              : { max: 1, min: 0 },
        },
      );

      const messages = (rest.messages || []).map((message: any) => {
        const { reasoning, ...messageRest } = message;

        const reasoningContent =
          typeof messageRest.reasoning_content === 'string'
            ? messageRest.reasoning_content
            : typeof reasoning?.content === 'string'
              ? reasoning.content
              : undefined;

        if (reasoningContent !== undefined) {
          return {
            ...messageRest,
            reasoning_content: reasoningContent,
          };
        }

        return messageRest;
      });

      return {
        ...rest,
        ...(isDeepSeekV4Model
          ? {
              ...(thinking?.type === 'enabled' || thinkingExplicitlyDisabled
                ? { enable_thinking: !thinkingExplicitlyDisabled }
                : {}),
              ...(!thinkingExplicitlyDisabled && reasoning_effort && { reasoning_effort }),
            }
          : isThinkingForcedQwenModel(model)
            ? {
                enable_thinking: true,
                ...(qwen38ReasoningEffort && { reasoning_effort: qwen38ReasoningEffort }),
                // A disabled preference carries budget_tokens: 0 — sending it alongside
                // a forced-on thinking flag would zero out the reasoning budget.
                ...(!thinkingExplicitlyDisabled &&
                  !qwen38ReasoningEffort && {
                    thinking_budget:
                      thinking?.budget_tokens === 0 ? 0 : thinking?.budget_tokens || undefined,
                  }),
              }
            : model.includes('-thinking')
              ? {
                  enable_thinking: true,
                  thinking_budget:
                    thinking?.budget_tokens === 0 ? 0 : thinking?.budget_tokens || undefined,
                }
              : thinking
                ? {
                    ...(thinking.type !== undefined && {
                      enable_thinking: thinking.type === 'enabled',
                    }),
                    thinking_budget:
                      thinking?.budget_tokens === 0 ? 0 : thinking?.budget_tokens || undefined,
                  }
                : {}),
        // qwen3.8-max preserves prior reasoning upstream by default (billing it as input
        // tokens), so an unset switch would silently keep thinking preserved while the UI
        // renders it off. Send an explicit `false` when the caller hasn't opted in so the
        // visible off state is honored; other models keep the upstream default untouched.
        ...(typeof preserveThinking === 'boolean'
          ? { preserve_thinking: preserveThinking }
          : isQwen38Max
            ? { preserve_thinking: false }
            : {}),
        frequency_penalty: undefined,
        messages,
        model,
        presence_penalty: resolvedParams.presence_penalty,
        stream: true,
        temperature: resolvedParams.temperature,
        top_p: resolvedParams.top_p,
        ...(enabledSearch && {
          enable_search: enabledSearch,
          search_options: {
            search_strategy: process.env.QWEN_SEARCH_STRATEGY || 'standard', // standard or pro
          },
        }),
        ...(payload.tools && {
          parallel_tool_calls: true,
        }),
      } as any;
    },
    handleStream: QwenAIStream,
  },
  createImage: createQwenImage,
  debug: {
    chatCompletion: () => process.env.DEBUG_QWEN_CHAT_COMPLETION === '1',
  },
  createVideo: createQwenVideo,
  handlePollVideoStatus: async (inferenceId, options) => {
    const { pollQwenVideoStatus } = await import('./createVideo');
    const baseURL = options.baseURL || '';

    const suffixIndex = baseURL.indexOf('/compatible-mode/v1');
    const dashscopeURL = suffixIndex > -1 ? baseURL.slice(0, suffixIndex) : baseURL;

    return pollQwenVideoStatus(inferenceId, options.apiKey || '', dashscopeURL);
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: QwenModelCard[] = modelsPage.data;

    return processMultiProviderModelList(modelList, 'qwen');
  },
  provider: ModelProvider.Qwen,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeQwenAI = createOpenAICompatibleRuntime(params);
