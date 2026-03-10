import { InferenceClient } from '@huggingface/inference';
import { ModelProvider } from 'model-bank';
import urlJoin from 'url-join';

import { convertOpenAIMessagesToHFFormat } from '../../core/contextBuilders/huggingface';
import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { convertIterableToStream } from '../../core/streams';
import { AgentRuntimeErrorType } from '../../types/error';
import { processMultiProviderModelList } from '../../utils/modelParse';
import type { HuggingFaceRouterModelCard, HuggingFaceRouterResponse } from './type';

export const params = {
  chatCompletion: {
    handleStreamBizErrorType: (error) => {
      // e.g.: Server meta-llama/Meta-Llama-3.1-8B-Instruct does not seem to support chat completion. Error: Model requires a Pro subscription; check out hf.co/pricing to learn more. Make sure to include your HF token in your query.
      if (error.message?.includes('Model requires a Pro subscription')) {
        return AgentRuntimeErrorType.PermissionDenied;
      }

      // e.g.: Server meta-llama/Meta-Llama-3.1-8B-Instruct does not seem to support chat completion. Error: Authorization header is correct, but the token seems invalid
      if (error.message?.includes('the token seems invalid')) {
        return AgentRuntimeErrorType.InvalidProviderAPIKey;
      }
    },
  },
  customClient: {
    createChatCompletionStream: (client: InferenceClient, payload, instance) => {
      const hfRes = client.chatCompletionStream({
        endpointUrl: instance.baseURL ? urlJoin(instance.baseURL, payload.model) : instance.baseURL,
        max_tokens: payload.max_tokens,
        messages: convertOpenAIMessagesToHFFormat(payload.messages),
        model: payload.model,
        stream: true,
        temperature: payload.temperature,
        //  `top_p` must be > 0.0 and < 1.0
        top_p: payload?.top_p
          ? payload?.top_p >= 1
            ? 0.99
            : payload?.top_p <= 0
              ? 0.01
              : payload?.top_p
          : undefined,
      });

      return convertIterableToStream(hfRes);
    },
    createClient: (options) =>
      new InferenceClient(options.apiKey ?? '', {
        endpointUrl: options.baseURL ?? undefined,
      }),
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_HUGGINGFACE_CHAT_COMPLETION === '1',
  },
  models: async () => {
    let modelList: HuggingFaceRouterModelCard[] = [];

    try {
      const response = await fetch('https://router.huggingface.co/v1/models');
      if (response.ok) {
        const data: HuggingFaceRouterResponse = await response.json();
        modelList = data.data;
      }
    } catch (error) {
      console.error('Failed to fetch HuggingFace router models:', error);
      return [];
    }

    const formattedModels = modelList
      .map((model) => {
        const { architecture, providers } = model;

        // Provider info selection priority: is_model_author > field completeness > first by default
        const mainProvider =
          providers.find((p) => p.is_model_author) ||
          providers.reduce((prev, curr) => {
            // Count the number of non-undefined fields for each provider
            const prevFieldCount = Object.values(prev).filter(
              (v) => v !== undefined && v !== null,
            ).length;
            const currFieldCount = Object.values(curr).filter(
              (v) => v !== undefined && v !== null,
            ).length;
            return currFieldCount > prevFieldCount ? curr : prev;
          }) ||
          providers[0];

        if (!mainProvider) {
          return undefined;
        }

        // Multi-provider fallback strategy: get from main provider first, fall back to others if missing
        const getFieldFromProviders = (field: keyof typeof mainProvider) => {
          const value = mainProvider[field];
          if (value !== undefined && value !== null) {
            return value;
          }
          // Traverse other providers when the field is missing
          return providers.find(
            (p) => p !== mainProvider && p[field] !== undefined && p[field] !== null,
          )?.[field];
        };

        const inputModalities = architecture?.input_modalities || [];
        const contextWindowTokens = getFieldFromProviders('context_length') as number | undefined;
        const supportsTools = getFieldFromProviders('supports_tools') as boolean | undefined;
        // const supportsStructuredOutput = getFieldFromProviders('supports_structured_output') as boolean | undefined;

        // displayName strips everything to the left of the slash from the id (e.g. 'zai-org/GLM-4.6' -> 'GLM-4.6')
        const displayName =
          typeof model.id === 'string' && model.id.includes('/')
            ? model.id.split('/').slice(1).join('/').trim()
            : model.id;

        const pricing = getFieldFromProviders('pricing') as
          | { input?: number; output?: number }
          | undefined;

        return {
          contextWindowTokens,
          created: model.created,
          displayName,
          functionCall: supportsTools ?? false,
          id: model.id,
          pricing,
          vision: inputModalities.includes('image') ?? false,
        };
      })
      .filter((m): m is Exclude<typeof m, undefined> => m !== undefined);

    return await processMultiProviderModelList(formattedModels, 'huggingface');
  },
  provider: ModelProvider.HuggingFace,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeHuggingFaceAI = createOpenAICompatibleRuntime(params);
