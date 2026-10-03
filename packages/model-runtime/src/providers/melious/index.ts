import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

export const DEFAULT_MELIOUS_BASE_URL = 'https://api.melious.ai/v1';

/**
 * Melious-specific metadata returned by `GET /v1/models?include_meta=true`.
 * Without `include_meta` the response is a plain OpenAI model list.
 */
export interface MeliousModelMeta {
  capabilities?: {
    function_calling?: boolean;
    structured_output?: boolean;
  };
  context_length?: number | null;
  input_modalities?: string[];
  max_output_tokens?: number | null;
  reasoning_type?: 'hybrid' | 'non_reasoning' | 'reasoning';
  release_date?: string | null;
  type?: string;
}

export interface MeliousModelCard {
  _meta?: MeliousModelMeta;
  id: string;
}

export const params = {
  baseURL: DEFAULT_MELIOUS_BASE_URL,
  debug: {
    chatCompletion: () => process.env.DEBUG_MELIOUS_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const base = (client as any).baseURL || DEFAULT_MELIOUS_BASE_URL;
    const url = `${base.replace(/\/+$/, '')}/models?include_meta=true`;

    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${client.apiKey}`,
      },
      method: 'GET',
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch Melious models: ${res.status} ${res.statusText}`);
    }

    const body = (await res.json()) as any;
    const rawList: MeliousModelCard[] = body?.data ?? [];

    const standardList = rawList
      // Melious serves chat, embedding, image, audio and guardrail models from the same
      // endpoint and offers no server-side type filter, so `_meta.type` is the only way to
      // keep non-chat models out of the picker. Treat a missing `_meta` as chat rather than
      // dropping everything, in case the deployment does not honour `include_meta`.
      .filter((model) => (model._meta?.type ?? 'chat') === 'chat')
      .map((model) => {
        const meta = model._meta ?? {};
        const modalities = meta.input_modalities ?? [];
        // `capabilities.vision` is under-populated upstream; the modality list is authoritative.
        const vision = modalities.includes('image');
        const reasoning = meta.reasoning_type ? meta.reasoning_type !== 'non_reasoning' : false;

        return {
          contextWindowTokens: meta.context_length ?? undefined,
          functionCall: meta.capabilities?.function_calling,
          id: model.id,
          maxOutput: meta.max_output_tokens ?? undefined,
          reasoning,
          releasedAt: meta.release_date ?? undefined,
          // Every reasoning model accepts `reasoning_effort` low|medium|high, with no off
          // state, so the control is always applicable where reasoning is supported.
          ...(reasoning && { settings: { extendParams: ['reasoningEffort' as const] } }),
          type: 'chat',
          video: modalities.includes('video'),
          vision,
        };
      });

    return processMultiProviderModelList(standardList, 'melious');
  },
  provider: ModelProvider.Melious,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeMeliousAI = createOpenAICompatibleRuntime(params);
