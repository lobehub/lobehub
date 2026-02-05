import { ModelProvider } from 'model-bank';

import { pruneReasoningPayload } from '../../core/contextBuilders/openai';
import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { AgentRuntimeErrorType } from '../../types/error';
import { processMultiProviderModelList } from '../../utils/modelParse';

export interface GithubModelCard {
  capabilities: string[];
  html_url: string;
  id: string;
  limits: {
    max_input_tokens: number;
    max_output_tokens: number;
  };
  name: string;
  publisher: string;
  rate_limit_tier: string;
  registry: string;
  summary: string;
  supported_input_modalities: string[];
  supported_output_modalities: string[];
  tags: string[];
  version: string;
}

/* eslint-enable typescript-sort-keys/interface */

export const params = {
  baseURL: 'https://models.github.ai/inference',
  chatCompletion: {
    handlePayload: (payload) => {
      const { model } = payload;

      if (model.startsWith('o1') || model.startsWith('o3')) {
        return { ...pruneReasoningPayload(payload), stream: false } as any;
      }

      if (model === 'xai/grok-3-mini') {
        return { ...payload, frequency_penalty: undefined, presence_penalty: undefined };
      }

      return { ...payload, stream: payload.stream ?? true };
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_GITHUB_CHAT_COMPLETION === '1',
  },
  errorType: {
    bizError: AgentRuntimeErrorType.ProviderBizError,
    invalidAPIKey: AgentRuntimeErrorType.InvalidGithubToken,
  },
  models: async () => {
    const response = await fetch('https://models.github.ai/catalog/models');
    const modelList: GithubModelCard[] = await response.json();

    const formattedModels = modelList.map((model) => ({
      contextWindowTokens: model.limits?.max_input_tokens + model.limits?.max_output_tokens,
      description: model.summary,
      displayName: model.name,
      functionCall: model.capabilities?.includes('tool-calling') ?? undefined,
      id: model.id,
      maxOutput: model.limits?.max_output_tokens ?? undefined,
      reasoning: model.tags?.includes('reasoning') ?? undefined,
      releasedAt:
        model.version && /^\d{4}-\d{2}-\d{2}$/.test(model.version) ? model.version : undefined,
      vision:
        (model.tags?.includes('multimodal') ||
          model.supported_input_modalities?.includes('image')) ??
        undefined,
    }));

    return await processMultiProviderModelList(formattedModels, 'github');
  },
  provider: ModelProvider.Github,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeGithubAI = createOpenAICompatibleRuntime(params);
