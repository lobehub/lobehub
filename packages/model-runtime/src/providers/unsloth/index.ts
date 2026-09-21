import type { ChatModelCard } from '@lobechat/types';
import debug from 'debug';
import { ModelProvider } from 'model-bank';
import { APIConnectionTimeoutError, APIError } from 'openai';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

const log = debug('lobe-model-runtime:unsloth');

export interface UnslothModelCard {
  context_length?: number;
  display_name?: string;
  id: string;
  loaded?: boolean;
}

interface UnslothModelProps {
  chat_template_caps?: {
    supports_reasoning_effort?: boolean;
    supports_tool_calls?: boolean;
    supports_tools?: boolean;
  };
  default_generation_settings?: { n_ctx?: number };
  modalities?: { vision?: boolean };
  model_path?: string;
}

export const params = {
  apiKey: 'placeholder-to-avoid-error',
  baseURL: 'http://127.0.0.1:8888/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_UNSLOTH_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');

    const modelsPage = await client.models.list();
    const modelList: UnslothModelCard[] = modelsPage.data;
    let props: UnslothModelProps | undefined;

    /** Studio's OpenAI model list omits abilities. Its llama.cpp-compatible props
     * describe only the resident model, so never apply them to other downloaded models.
     * https://github.com/unslothai/unsloth/blob/main/studio/backend/routes/llama_compat.py
     */
    if (modelList.some((model) => model.loaded !== false)) {
      try {
        /** Keep the configured API prefix: a reverse proxy may expose only /v1 routes. */
        props = await client.get<UnslothModelProps>(`${client.baseURL.replace(/\/$/, '')}/props`, {
          maxRetries: 0,
          timeout: 2000,
        });
      } catch (error) {
        /** Error bodies and configured URLs can contain credentials; log only safe diagnostics. */
        log('Model properties unavailable; using catalog metadata. %O', {
          reason: error instanceof APIConnectionTimeoutError ? 'timeout' : 'request_failed',
          route: 'props',
          status: error instanceof APIError ? error.status : undefined,
        });
      }
    }

    return modelList.map((model) => {
      const knownModel = LOBE_DEFAULT_MODEL_LIST.find(
        (m) => model.id.toLowerCase() === m.id.toLowerCase(),
      );
      const modelProps =
        model.loaded !== false && props?.model_path === model.id ? props : undefined;
      const caps = modelProps?.chat_template_caps;
      const supportsTools = caps?.supports_tools;
      const supportsToolCalls = caps?.supports_tool_calls;
      const functionCall =
        supportsTools === false || supportsToolCalls === false
          ? false
          : (supportsTools ?? supportsToolCalls ?? knownModel?.abilities?.functionCall ?? false);
      const contextWindowTokens = [
        model.context_length,
        modelProps?.default_generation_settings?.n_ctx,
        knownModel?.contextWindowTokens,
      ].find((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);
      /** Effort-parameter support is a positive hint, not an exhaustive thinking capability.
       * Templates using enable_thinking can report false here while still supporting reasoning.
       * https://github.com/ggml-org/llama.cpp/blob/d59d455f/common/jinja/caps.cpp
       */
      const reasoning =
        caps?.supports_reasoning_effort === true || knownModel?.abilities?.reasoning === true;

      return {
        contextWindowTokens,
        displayName: model.display_name ?? knownModel?.displayName,
        enabled: model.loaded ?? false,
        functionCall,
        id: model.id,
        reasoning,
        vision: modelProps?.modalities?.vision ?? knownModel?.abilities?.vision ?? false,
      };
    }) satisfies ChatModelCard[];
  },
  provider: ModelProvider.Unsloth,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeUnslothAI = createOpenAICompatibleRuntime(params);
