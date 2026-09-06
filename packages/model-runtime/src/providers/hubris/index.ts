import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

export interface HubrisModelCard {
  context_window?: number;
  created?: number;
  description?: string;
  display_name?: string;
  id: string;
  input_modalities?: string[];
  object: string;
  output_modalities?: string[];
  owned_by: string;
  supported_parameters?: string[];
}

interface HubrisReasoning {
  effort?: 'low' | 'medium' | 'high';
  enabled?: boolean;
  max_tokens?: number;
}

/**
 * Catalogue names carry a vendor prefix for some entries ("Anthropic: Claude
 * Sonnet 5") and not for others ("Claude Opus 5"). The provider column already
 * names the vendor, so drop the prefix when it is there.
 */
const stripVendorPrefix = (displayName?: string) => {
  if (!displayName) return undefined;
  const colonIndex = displayName.indexOf(':');
  return colonIndex === -1 ? displayName : displayName.slice(colonIndex + 1).trim();
};

export const params = {
  baseURL: 'https://api.hubris.pw/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { reasoning_effort, thinking, reasoning: _reasoning, ...rest } = payload;

      // Hubris takes reasoning in the OpenRouter shape: `reasoning.effort`,
      // `reasoning.max_tokens` or `reasoning.enabled: false`.
      let reasoning: HubrisReasoning | undefined;

      if (thinking?.type === 'disabled') {
        reasoning = { enabled: false };
      } else if (thinking?.budget_tokens !== undefined) {
        reasoning = { max_tokens: thinking.budget_tokens };
      } else if (reasoning_effort) {
        reasoning = { effort: reasoning_effort };
      }

      return {
        ...rest,
        ...(reasoning && { reasoning }),
        stream: payload.stream ?? true,
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_HUBRIS_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: HubrisModelCard[] = modelsPage.data || [];

    // Map Hubris' own metadata onto the card before the generic keyword-based
    // inference runs; leave a flag undefined when the catalogue omits the field
    // so the heuristics still get a chance instead of being told "false".
    const formattedModels = modelList.map((model) => {
      const { context_window, created, input_modalities, supported_parameters } = model;

      return {
        contextWindowTokens: context_window,
        description: model.description,
        displayName: stripVendorPrefix(model.display_name),
        functionCall: supported_parameters
          ? supported_parameters.includes('tools')
          : undefined,
        id: model.id,
        reasoning: supported_parameters
          ? supported_parameters.includes('reasoning') ||
            supported_parameters.includes('reasoning_effort')
          : undefined,
        releasedAt: created
          ? new Date(created * 1000).toISOString().split('T')[0]
          : undefined,
        video: input_modalities ? input_modalities.includes('video') : undefined,
        vision: input_modalities ? input_modalities.includes('image') : undefined,
      };
    });

    return processMultiProviderModelList(formattedModels, 'hubris');
  },
  provider: ModelProvider.Hubris,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeHubrisAI = createOpenAICompatibleRuntime(params);
