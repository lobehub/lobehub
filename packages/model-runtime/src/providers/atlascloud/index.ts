import createDebug from 'debug';
import { ModelProvider } from 'model-bank';

import {
  OpenAICompatibleFactoryOptions,
  createOpenAICompatibleRuntime,
} from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';
import { createAtlasCloudImage } from './createImage';
import { AtlasCloudModelCard } from './type';

const log = createDebug('lobe-chat:atlascloud');

const formatPrice = (price?: string | number) => {
  if (price === undefined || price === null || price === '-1') return undefined;
  const numPrice = typeof price === 'string' ? Number(price) : price;
  if (Number.isNaN(numPrice)) return undefined;
  // Convert to per million tokens pricing
  return Number((numPrice * 1e6).toPrecision(5));
};

export const params = {
  baseURL: 'https://api.atlascloud.ai/v1',
  createImage: createAtlasCloudImage,
  debug: {
    chatCompletion: () => process.env.DEBUG_ATLASCLOUD_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    let modelList: AtlasCloudModelCard[] = [];

    try {
      const response = await client.models.list();
      modelList = response.data as AtlasCloudModelCard[];
    } catch (error) {
      log('Failed to fetch Atlas Cloud models: %O', error);
      return [];
    }

    // Process the model list and transform to standard format
    const formattedModels = modelList.map((model) => {
      // Extract capabilities from model data if available
      const capabilities = model.capabilities || {};
      const pricing = model.pricing || {};
      const contextLength = model.context_length || model.contextWindowTokens;
      const maxOutput = model.max_output || model.maxOutput;

      // Format display name - clean up model ID for display
      let displayName = model.name || model.id;

      // If displayName contains provider prefix (e.g., "openai/gpt-4"), extract just the model name
      if (displayName.includes('/')) {
        const parts = displayName.split('/');
        displayName = parts.at(-1) ?? displayName;
      }

      // Format pricing if available
      const inputPrice = formatPrice(pricing.prompt || pricing.input);
      const outputPrice = formatPrice(pricing.completion || pricing.output);
      const cachedInputPrice = formatPrice(pricing.cached_input || pricing.cachedInput);

      return {
        contextWindowTokens: contextLength,
        description: model.description,
        displayName,
        // Check various capability formats
        functionCall:
          capabilities.function_calling || capabilities.functionCall || capabilities.tools || false,
        id: model.id,
        maxOutput,
        pricing: {
          cachedInput: cachedInputPrice,
          input: inputPrice,
          output: outputPrice,
        },
        reasoning: capabilities.reasoning || false,
        releasedAt: model.created
          ? new Date(typeof model.created === 'number' ? model.created * 1000 : model.created)
              .toISOString()
              .split('T')[0]
          : undefined,
        type: 'chat' as const,
        vision: capabilities.vision || capabilities.image || false,
      };
    });

    // Use processMultiProviderModelList to automatically detect and enhance model capabilities
    // based on known model patterns (e.g., gpt-4, claude, gemini, etc.)
    return await processMultiProviderModelList(formattedModels, 'atlascloud');
  },
  provider: ModelProvider.AtlasCloud,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeAtlasCloudAI = createOpenAICompatibleRuntime(params);
