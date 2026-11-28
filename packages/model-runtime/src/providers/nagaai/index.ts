import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatible';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatible';
import type { ChatResponseFormat, ChatStreamPayload } from '../../types';
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
    // A parameter the row does not list is left unset, not `false`: model-bank
    // and the keyword rules then decide, as for magpie.
    functionCall: 'tools' in params || undefined,
    id: model.id,
    pricing: { cachedInput, input, output },
    reasoning: 'reasoning_effort' in params || undefined,
    vision: model.architecture?.input_modalities?.includes('image') || undefined,
  };
};

/**
 * NagaAI serves every listed chat model on the Responses API, its primary API.
 * The app sends `apiMode: 'chatCompletion'` for any provider whose Responses
 * switch is off, and that outranks `useResponse`, so the mode is set here, after
 * the choice, as for xAI and Meta.
 */
const handleNagaAIChatPayload = (payload: ChatStreamPayload) =>
  ({
    ...payload,
    apiMode: 'responses',
    stream: payload.stream ?? true,
  }) as any;

/**
 * NagaAI's Responses API takes structured output under `text.format`
 * (https://docs.naga.ac/guides/structured-outputs), while callers send the
 * Chat Completions `response_format` shape.
 */
const mapResponseFormatToResponsesText = (
  responseFormat?: ChatResponseFormat,
  text?: ChatStreamPayload['text'],
) => {
  if (!responseFormat) return text;

  if (responseFormat.type === 'json_schema') {
    return { ...text, format: { type: 'json_schema', ...responseFormat.json_schema } };
  }

  return { ...text, format: { type: responseFormat.type } };
};

/**
 * Search is the `web_search` tool on NagaAI's Responses API
 * (https://docs.naga.ac/build/web-search); `enabledSearch` is LobeHub's own
 * flag and is not sent upstream.
 */
export const handleNagaAIResponsesPayload = (payload: ChatStreamPayload) => {
  const { enabledSearch, response_format, text, tools, ...rest } = payload;

  return {
    ...rest,
    text: mapResponseFormatToResponsesText(response_format, text),
    tools: enabledSearch ? [...(tools || []), { type: 'web_search' }] : tools,
  } as any;
};

export const params = {
  baseURL: 'https://api.naga.ac/v1',
  chatCompletion: {
    handlePayload: handleNagaAIChatPayload,
    useResponse: true,
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_NAGAAI_CHAT_COMPLETION === '1',
    responses: () => process.env.DEBUG_NAGAAI_RESPONSES === '1',
  },
  // Structured output reads only this flag, not the chat one.
  generateObject: {
    useResponse: true,
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const rows: NagaAIModelCard[] = modelsPage.data || [];

    const modelList = rows.map(toChatModel).filter((model) => !!model);

    return processMultiProviderModelList(modelList, 'nagaai');
  },
  provider: ModelProvider.NagaAI,
  responses: {
    handlePayload: handleNagaAIResponsesPayload,
  },
} satisfies OpenAICompatibleFactoryOptions;

export const LobeNagaAI = createOpenAICompatibleRuntime(params);
