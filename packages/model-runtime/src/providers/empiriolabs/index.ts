import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatible';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatible';
import { processMultiProviderModelList } from '../../utils/modelParse';
import { createEmpirioLabsImage } from './createImage';
import { createEmpirioLabsVideo, pollEmpirioLabsVideoStatus } from './createVideo';

interface EmpirioLabsPricing {
  completion?: string;
  prompt?: string;
}

/**
 * The fields of a `GET /v1/models` entry that this provider reads.
 * @see https://docs.empiriolabs.ai/api-reference/api-reference/models/list-models
 */
export interface EmpirioLabsModelCard {
  capabilities?: { reasoning?: boolean };
  category?: string;
  context_window?: number;
  description?: string;
  display_name?: string;
  features?: string[];
  id: string;
  input_modalities?: string[];
  max_output_tokens?: number;
  /** One price, or price tiers by context size with the base tier first. USD per token. */
  pricing?: EmpirioLabsPricing | EmpirioLabsPricing[];
}

/** USD per token, as the API returns it, to USD per million tokens. */
const perMillionTokens = (price?: string): number | undefined => {
  const value = Number(price);
  if (price === undefined || price === '' || !Number.isFinite(value) || value < 0) return undefined;

  return Number((value * 1_000_000).toFixed(6));
};

const toPricing = (pricing: EmpirioLabsModelCard['pricing']) => {
  const tier = Array.isArray(pricing) ? pricing[0] : pricing;
  if (!tier) return undefined;

  return {
    input: perMillionTokens(tier.prompt),
    output: perMillionTokens(tier.completion),
  };
};

export const params = {
  baseURL: 'https://api.empiriolabs.ai/v1',
  createImage: createEmpirioLabsImage,
  createVideo: createEmpirioLabsVideo,
  debug: {
    chatCompletion: () => process.env.DEBUG_EMPIRIOLABS_CHAT_COMPLETION === '1',
  },
  handlePollVideoStatus: async (inferenceId, options) =>
    pollEmpirioLabsVideoStatus(inferenceId, { apiKey: options.apiKey, baseURL: options.baseURL }),
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const rawList: EmpirioLabsModelCard[] = modelsPage.data || [];

    // The endpoint lists every model the API serves. Chat models are the text
    // ones; an id with ":" is a variant of a model that is already listed. Image
    // and video models come from the built-in cards, which carry their parameters.
    const modelList = rawList
      .filter((model) => model.category === 'text' && !model.id.includes(':'))
      .map((model) => {
        const features = model.features || [];

        return {
          contextWindowTokens: model.context_window,
          description: model.description,
          displayName: model.display_name,
          functionCall: features.includes('function_calling'),
          id: model.id,
          // Abilities this provider does not map stay off instead of being guessed from the model id.
          imageOutput: false,
          maxOutput: model.max_output_tokens,
          pricing: toPricing(model.pricing),
          reasoning: !!model.capabilities?.reasoning || features.includes('reasoning'),
          search: false,
          type: 'chat',
          video: false,
          vision: (model.input_modalities || []).includes('image'),
        };
      });

    return processMultiProviderModelList(modelList, 'empiriolabs');
  },
  provider: ModelProvider.EmpirioLabs,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeEmpirioLabsAI = createOpenAICompatibleRuntime(params);
