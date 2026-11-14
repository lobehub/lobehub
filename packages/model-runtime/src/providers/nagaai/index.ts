import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatible';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatible';
import { processMultiProviderModelList } from '../../utils/modelParse';

interface NagaAIPrice {
  meter: string;
  price: string;
}

interface NagaAIOperation {
  endpoints?: string[];
  limits?: { context_window?: number };
  operation: string;
  parameters?: Record<string, unknown>;
}

/** One row of NagaAI's `GET /v1/models`. */
export interface NagaAIModelCard {
  architecture?: { input_modalities?: string[] };
  description?: string;
  display_name?: string;
  id: string;
  operations?: NagaAIOperation[];
  pricing?: NagaAIPrice[];
}

/** USD per token, as the gateway lists it, to USD per million tokens. */
const perMillion = (pricing: NagaAIPrice[] | undefined, meter: string) => {
  const row = pricing?.find((p) => p.meter === meter);
  if (!row) return undefined;

  const value = Number(row.price);
  return Number.isFinite(value) ? Math.round(value * 1e12) / 1e6 : undefined;
};

/**
 * A chat model card from a /v1/models row, or nothing for a model that does
 * not chat on the Responses API (images, speech, embeddings). What the row leaves unsaid is filled
 * from model-bank by `processMultiProviderModelList`.
 */
export const toChatModel = (model: NagaAIModelCard) => {
  const chat = model.operations?.find((op) => op.operation === 'chat');
  if (!chat?.endpoints?.includes('responses')) return undefined;

  const params = chat.parameters ?? {};
  const input = perMillion(model.pricing, 'input_token');
  const output = perMillion(model.pricing, 'output_token');
  const cachedInput = perMillion(model.pricing, 'cached_input_token');

  return {
    contextWindowTokens: chat.limits?.context_window,
    description: model.description,
    displayName: model.display_name,
    functionCall: 'tools' in params,
    id: model.id,
    pricing: { cachedInput, input, output },
    reasoning: 'reasoning_effort' in params,
    vision: model.architecture?.input_modalities?.includes('image') ?? false,
  };
};

export const params = {
  baseURL: 'https://api.naga.ac/v1',
  // NagaAI serves every chat model on the Responses API, its primary API, so
  // chats go there; Chat Completions stays available on the same base URL.
  chatCompletion: {
    useResponse: true,
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_NAGAAI_CHAT_COMPLETION === '1',
    responses: () => process.env.DEBUG_NAGAAI_RESPONSES === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const rows: NagaAIModelCard[] = modelsPage.data || [];

    const modelList = rows.map(toChatModel).filter((model) => !!model);

    return processMultiProviderModelList(modelList, 'nagaai');
  },
  provider: ModelProvider.NagaAI,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeNagaAI = createOpenAICompatibleRuntime(params);
