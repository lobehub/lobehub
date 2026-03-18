import { LOBE_DEFAULT_MODEL_LIST, ModelProvider } from 'model-bank';
import urlJoin from 'url-join';

import { responsesAPIModels } from '../../const/models';
import { createRouterRuntime } from '../../core/RouterRuntime';
import type { CreateRouterRuntimeOptions } from '../../core/RouterRuntime/createRuntime';
import { processMultiProviderModelList } from '../../utils/modelParse';

export interface OpenCodeZenModelCard {
  created: number;
  id: string;
  object: string;
  owned_by: string;
}

const DEFAULT_BASE_URL = 'https://opencode.ai/zen';

const CLAUDE_MODELS = [
  'claude-opus-4-6',
  'claude-opus-4-5',
  'claude-opus-4-1',
  'claude-sonnet-4-6',
  'claude-sonnet-4-5',
  'claude-sonnet-4',
  'claude-haiku-4-5',
  'claude-3-5-haiku',
];

const GEMINI_MODELS = ['gemini-3.1-pro', 'gemini-3-flash'];

const GPT_MODELS = [
  'gpt-5.4',
  'gpt-5.4-pro',
  'gpt-5.4-mini',
  'gpt-5.4-nano',
  'gpt-5.3-codex',
  'gpt-5.3-codex-spark',
  'gpt-5.2',
  'gpt-5.2-codex',
  'gpt-5.1',
  'gpt-5.1-codex',
  'gpt-5.1-codex-max',
  'gpt-5.1-codex-mini',
  'gpt-5',
  'gpt-5-codex',
  'gpt-5-nano',
];

const isClaudeModel = (modelId: string): boolean => {
  return CLAUDE_MODELS.includes(modelId) || modelId.startsWith('claude-');
};

const isGeminiModel = (modelId: string): boolean => {
  return GEMINI_MODELS.includes(modelId) || modelId.startsWith('gemini-');
};

const isGptModel = (modelId: string): boolean => {
  return GPT_MODELS.includes(modelId) || modelId.startsWith('gpt-5');
};

export const params = {
  chatCompletion: {
    handlePayload: (payload) => {
      const { reasoning_effort, thinking, reasoning, ...rest } = payload;

      const finalReasoning = {
        ...reasoning,
        ...(reasoning_effort && { effort: reasoning_effort }),
        ...(thinking?.budget_tokens && { max_tokens: thinking.budget_tokens }),
        ...(thinking?.type === 'enabled' && { enabled: true }),
        ...(thinking?.type === 'disabled' && { enabled: false }),
      };

      const hasReasoning = Object.keys(finalReasoning).length > 0;

      return {
        ...rest,
        ...(hasReasoning && { reasoning: finalReasoning }),
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_OPENCODEZEN_CHAT_COMPLETION === '1',
    responses: () => process.env.DEBUG_OPENCODEZEN_RESPONSES === '1',
  },
  id: ModelProvider.OpenCodeZen,
  models: async ({ client: openAIClient }) => {
    const modelsPage = (await openAIClient.models.list()) as any;
    const modelList: OpenCodeZenModelCard[] = modelsPage.data || [];

    return processMultiProviderModelList(modelList, 'opencodezen');
  },
  routers: (options) => {
    const baseURL = options.baseURL || DEFAULT_BASE_URL;
    const userBaseURL = baseURL.replace(/\/v\d+[a-z]*\/?$/, '').replace(/\/api\/?$/, '');

    return [
      {
        apiType: 'anthropic',
        models: LOBE_DEFAULT_MODEL_LIST.map((m) => m.id).filter((id) => isClaudeModel(id)),
        options: {
          ...options,
          baseURL: urlJoin(userBaseURL, '/v1/messages'),
        },
      },
      {
        apiType: 'google',
        models: LOBE_DEFAULT_MODEL_LIST.map((m) => m.id).filter((id) => isGeminiModel(id)),
        options: {
          ...options,
          baseURL: urlJoin(userBaseURL, '/v1'),
        },
      },
      {
        apiType: 'openai',
        models: LOBE_DEFAULT_MODEL_LIST.map((m) => m.id).filter((id) => isGptModel(id)),
        options: {
          ...options,
          baseURL: urlJoin(userBaseURL, '/v1'),
          chatCompletion: {
            useResponseModels: [...Array.from(responsesAPIModels), /^gpt-5/],
          },
        },
      },
      {
        apiType: 'openai',
        options: {
          ...options,
          baseURL: urlJoin(userBaseURL, '/v1'),
        },
      },
    ];
  },
} satisfies CreateRouterRuntimeOptions;

export const LobeOpenCodeZenAI = createRouterRuntime(params);
