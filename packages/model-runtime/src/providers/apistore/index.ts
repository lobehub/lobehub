import { ModelProvider } from 'model-bank';

import { pruneReasoningPayload } from '../../core/contextBuilders/openai';
import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatible';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatible';
import { processMultiProviderModelList } from '../../utils/modelParse';
import { isOpenAIReasoningPayloadModel } from '../openai/modelId';

export interface APIStoreModelCard {
  context_length?: number;
  id: string;
  /**
   * `chat`, `image` or `video`. The list mixes all three, and only chat models
   * are served on Chat Completions.
   */
  kind?: string;
  max_output_tokens?: number;
  name?: string;
  owned_by?: string;
}

export const params = {
  baseURL: 'https://api.apistore.cloud/v1',
  chatCompletion: {
    // Every model, Claude and Gemini included, is served on Chat Completions and takes its
    // reasoning level as `reasoning_effort`. A card fetched from the model list can carry the
    // vendor's own controls (`effort` for Claude, `thinkingLevel` for Gemini), which this
    // endpoint does not read, so they are sent as `reasoning_effort` instead.
    handlePayload: (payload) => {
      const {
        effort,
        thinking: _thinking,
        thinkingBudget: _thinkingBudget,
        thinkingLevel,
        ...rest
      } = payload as any;
      const reasoningEffort = rest.reasoning_effort ?? effort ?? thinkingLevel;

      const result = {
        ...rest,
        ...(reasoningEffort && { reasoning_effort: reasoningEffort }),
        stream: rest.stream ?? true,
      };

      // GPT-5+ reasoning models refuse sampling parameters such as `top_p`; drop them the same
      // way the OpenAI provider does.
      return (
        isOpenAIReasoningPayloadModel(result.model) ? pruneReasoningPayload(result) : result
      ) as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_APISTORE_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const rawList: APIStoreModelCard[] = modelsPage.data || [];

    const modelList = rawList
      .filter((model) => !model.kind || model.kind === 'chat')
      .map((model) => ({
        contextWindowTokens: model.context_length,
        // Some catalog names are just the id; leave those to the model-bank card's name.
        displayName: model.name && model.name !== model.id ? model.name : undefined,
        id: model.id,
        maxOutput: model.max_output_tokens,
      }));

    const models = await processMultiProviderModelList(modelList, 'apistore');

    // Abilities and settings looked up from the vendors' own cards describe their native APIs.
    // On API Store every model is reached through Chat Completions: no hosted web search or
    // video input, reasoning set with `reasoning_effort`, and image input on Claude, GPT and
    // Gemini only.
    return models.map((model) => {
      const {
        searchImpl: _searchImpl,
        searchProvider: _searchProvider,
        ...settings
      } = model.settings ?? {};

      return {
        ...model,
        search: false,
        settings: { ...settings, extendParams: ['reasoningEffort'] },
        video: false,
        vision: !model.id.startsWith('deepseek'),
      };
    });
  },
  provider: ModelProvider.APIStore,
  // API Store serves every model, GPT-6 included, on Chat Completions only.
  responsesApiUnsupported: true,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeAPIStoreAI = createOpenAICompatibleRuntime(params);
