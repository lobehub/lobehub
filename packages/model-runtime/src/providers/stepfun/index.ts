import type { ChatModelCard } from '@lobechat/types';
import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export interface StepfunModelCard {
  id: string;
}

export const params = {
  baseURL: 'https://api.stepfun.com/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { enabledSearch, tools, ...rest } = payload;

      const stepfunTools = enabledSearch
        ? [
            ...(tools || []),
            {
              function: {
                description: 'use web_search to search information on the internet',
              },
              type: 'web_search',
            },
          ]
        : tools;

      return {
        ...rest,
        stream: !stepfunTools,
        tools: stepfunTools,
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_STEPFUN_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');

    // ref: https://platform.stepfun.com/docs/llm/modeloverview
    const functionCallKeywords = ['step-1-', 'step-1o-', 'step-1v-', 'step-2-'];

    const visionKeywords = ['step-1o-', 'step-r1-v-', 'step-1v-'];

    const reasoningKeywords = ['step-r1-'];

    const modelsPage = (await client.models.list()) as any;
    const modelList: StepfunModelCard[] = modelsPage.data;

    return modelList
      .map((model) => {
        const knownModel = LOBE_DEFAULT_MODEL_LIST.find(
          (m) => model.id.toLowerCase() === m.id.toLowerCase(),
        );

        return {
          contextWindowTokens: knownModel?.contextWindowTokens ?? undefined,
          displayName: knownModel?.displayName ?? undefined,
          enabled: knownModel?.enabled || false,
          functionCall:
            functionCallKeywords.some((keyword) => model.id.toLowerCase().includes(keyword)) ||
            knownModel?.abilities?.functionCall ||
            false,
          id: model.id,
          reasoning:
            reasoningKeywords.some((keyword) => model.id.toLowerCase().includes(keyword)) ||
            knownModel?.abilities?.reasoning ||
            false,
          vision:
            visionKeywords.some((keyword) => model.id.toLowerCase().includes(keyword)) ||
            knownModel?.abilities?.vision ||
            false,
        };
      })
      .filter(Boolean) as ChatModelCard[];
  },
  provider: ModelProvider.Stepfun,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeStepfunAI = createOpenAICompatibleRuntime(params);
