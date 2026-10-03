import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

/**
 * A row of `GET https://api.flex.ai/v1/models`. The endpoint is OpenAI-shaped
 * but carries extra catalogue metadata, so the model list is mapped explicitly
 * rather than left to keyword inference.
 */
export interface FlexAIModelCard {
  category?: string;
  context_length?: number;
  id: string;
  name?: string;
  pricing?: {
    cached_input_per_mtok?: number;
    input_per_mtok?: number;
    output_per_mtok?: number;
  };
  supports?: string[];
}

const CHAT_CATEGORIES = new Set(['code', 'reasoning', 'text', 'vision']);

/**
 * `category` names the task the model is served for; `supports` lists the
 * endpoints it answers. A row is a chat model only when both agree — the OCR
 * model, for instance, is `category: 'vision'` but supports `image_input`
 * alone and has no chat endpoint.
 *
 * `image_generation` rows are deliberately not surfaced: an image card needs a
 * `ModelParamsSchema` describing the parameters the endpoint accepts, which
 * this integration has not established, and `processModelCard` drops an image
 * model without one anyway.
 */
const resolveType = (model: FlexAIModelCard): string | undefined => {
  const supports = model.supports ?? [];
  if (supports.includes('chat')) {
    return CHAT_CATEGORIES.has(model.category ?? '') ? 'chat' : undefined;
  }
  if (supports.includes('embeddings')) return 'embedding';
  if (supports.includes('audio_speech')) return 'tts';
  if (supports.includes('audio_transcription')) return 'asr';
  return undefined;
};

export const params = {
  baseURL: 'https://api.flex.ai/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_FLEXAI_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: FlexAIModelCard[] = modelsPage.data || [];

    const standardList = modelList
      .map((model) => {
        const type = resolveType(model);
        if (!type) return undefined;

        const supports = model.supports ?? [];
        const pricing = model.pricing ?? {};

        return {
          contextWindowTokens: model.context_length ?? undefined,
          displayName: model.name ?? model.id,
          functionCall: supports.includes('tool_use'),
          id: model.id,
          pricing: {
            cachedInput: pricing.cached_input_per_mtok,
            input: pricing.input_per_mtok,
            output: pricing.output_per_mtok,
          },
          type,
          vision: supports.includes('vision'),
        };
      })
      .filter((model) => !!model);

    return processMultiProviderModelList(standardList as any, 'flexai');
  },
  provider: ModelProvider.FlexAI,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeFlexAI = createOpenAICompatibleRuntime(params);
