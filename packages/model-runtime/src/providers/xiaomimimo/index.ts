import { ModelProvider, xiaomimimo as xiaomimimoChatModels } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { getModelMaxOutputs } from '../../utils/getModelMaxOutputs';
import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export interface XiaomiMiMoModelCard {
  id: string;
}

export const params = {
  baseURL: 'https://api.xiaomimimo.com/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { enabledSearch, thinking, temperature, tools, top_p, max_tokens, stream, ...rest } =
        payload as any;
      const thinkingType = thinking?.type;

      const xiaomiTools = enabledSearch
        ? [
            ...(tools || []),
            {
              type: 'web_search',
            },
          ]
        : tools;

      const messages = payload.messages?.map((message: any) => {
        const { reasoning, ...rest } = message;

        const reasoningContent =
          typeof rest.reasoning_content === 'string'
            ? rest.reasoning_content
            : typeof reasoning?.content === 'string'
              ? reasoning.content
              : undefined;

        // Thinking Mode with tool calls requires assistant history messages to carry reasoning_content
        if (message.role === 'assistant' && thinkingType === 'enabled') {
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

      return {
        ...rest,
        max_completion_tokens:
          max_tokens !== undefined
            ? max_tokens
            : getModelMaxOutputs(payload.model, xiaomimimoChatModels),
        messages,
        stream: stream ?? true,
        tools: xiaomiTools,
        ...(typeof temperature === 'number'
          ? { temperature: clamp(temperature, 0, 1.5) }
          : undefined),
        ...(typeof top_p === 'number' ? { top_p: clamp(top_p, 0.01, 1) } : undefined),
        ...(thinkingType === 'enabled' || thinkingType === 'disabled'
          ? { thinking: { type: thinkingType } }
          : undefined),
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_XIAOMIMIMO_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: XiaomiMiMoModelCard[] = modelsPage.data;

    return processModelList(modelList, MODEL_LIST_CONFIGS.xiaomimimo, 'xiaomimimo');
  },
  provider: ModelProvider.XiaomiMiMo,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeXiaomiMiMoAI = createOpenAICompatibleRuntime(params);
