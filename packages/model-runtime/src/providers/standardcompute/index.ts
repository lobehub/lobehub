import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

export interface StandardComputeModelCard {
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  context_length?: number;
  display_name?: string;
  id: string;
  object?: string;
  owned_by?: string;
  supported_parameters?: string[];
}

export const params = {
  baseURL: 'https://api.stdcmpt.com/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_STANDARDCOMPUTE_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: StandardComputeModelCard[] = modelsPage.data || [];

    // Map the gateway's own metadata before the generic keyword-based inference
    // runs. A capability the gateway does not report is left undefined.
    const formattedModels = modelList.map((model) => {
      const { architecture, context_length, display_name, id, supported_parameters } = model;
      const inputModalities = architecture?.input_modalities;

      return {
        contextWindowTokens: context_length,
        displayName: display_name,
        functionCall: supported_parameters ? supported_parameters.includes('tools') : undefined,
        id,
        reasoning: supported_parameters ? supported_parameters.includes('reasoning') : undefined,
        video: inputModalities ? inputModalities.includes('video') : undefined,
        vision: inputModalities ? inputModalities.includes('image') : undefined,
      };
    });

    return processMultiProviderModelList(formattedModels, 'standardcompute');
  },
  provider: ModelProvider.StandardCompute,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeStandardComputeAI = createOpenAICompatibleRuntime(params);
