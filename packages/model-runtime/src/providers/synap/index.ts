import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';
import type { SynapModelCard } from './type';

const fetchSynapModels = async () => {
  const response = await fetch('https://synap.linkrra.com/v1/models');
  if (!response.ok) {
    throw new Error(`Synap models API request failed with status ${response.status}`);
  }

  const data = (await response.json()) as { data: SynapModelCard[] };
  return data.data;
};

export const params = {
  baseURL: 'https://synap.linkrra.com/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_SYNAP_CHAT_COMPLETION === '1',
  },
  models: async () => {
    const modelList = await fetchSynapModels();

    const formattedModels = modelList.map((model) => {
      // The two router ids and the two team-agent ids carry only `pricing` and
      // `capability`; the self-hosted fleet models additionally carry a full
      // modality breakdown once they have a `schema_version`.
      const inputModality = model.input_modalities?.[0];
      const outputModality = model.output_modalities?.[0];

      const contextWindowTokens = inputModality?.supported_inputs?.max_context_length?.value;
      const maxOutput = outputModality?.max_length?.value;
      const functionCall = outputModality?.supported_parameters
        ? 'tools' in outputModality.supported_parameters
        : undefined;
      const vision = model.input_modalities?.some((m) => m.type === 'image');

      return {
        contextWindowTokens,
        description: model.context_note ?? model.capability,
        displayName: model.name ?? model.id,
        functionCall,
        id: model.id,
        maxOutput,
        pricing: model.pricing
          ? {
              input: model.pricing.prompt_per_million,
              output: model.pricing.completion_per_million,
            }
          : undefined,
        releasedAt: model.created
          ? new Date(model.created * 1000).toISOString().split('T')[0]
          : undefined,
        vision,
      };
    });

    return await processMultiProviderModelList(formattedModels, 'synap');
  },
  provider: ModelProvider.Synap,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeSynapAI = createOpenAICompatibleRuntime(params);
