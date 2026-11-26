import {
  LOBE_DEFAULT_MODEL_LIST,
  ModelProvider,
  proxystacks as proxystacksModels,
} from 'model-bank';
import urlJoin from 'url-join';

import { createRouterRuntime } from '../../core/RouterRuntime';
import type { CreateRouterRuntimeOptions } from '../../core/RouterRuntime/createRuntime';
import type { ChatMethodOptions, ChatStreamPayload } from '../../types';
import { processMultiProviderModelList } from '../../utils/modelParse';
import { isResponsesAPIModel, responsesAPIModels } from '../openai/modelId';
import { resolveProviderRouteModels } from '../utils/resolveProviderRouteModels';

const DEFAULT_BASE_URL = 'https://proxystacks.com';

const LOCAL_MODEL_MAP = new Map(proxystacksModels.map((card) => [card.id.toLowerCase(), card]));

const RESPONSE_API_MODELS: Array<string | RegExp> = [
  ...Array.from(responsesAPIModels),
  /gpt-\d(?!\d)/,
  /^o\d/,
];

const matchesResponseApiModel = (model?: string) =>
  Boolean(
    model &&
      (isResponsesAPIModel(model) ||
        RESPONSE_API_MODELS.some((pattern) =>
          typeof pattern === 'string' ? model.includes(pattern) : pattern.test(model),
        )),
  );

const resolveRootBaseURL = (baseURL?: string | null) =>
  baseURL?.trim().replace(/\/v\d+[a-z]*\/?$/, '').replace(/\/anthropic\/?$/, '') ||
  DEFAULT_BASE_URL;

export const params = {
  debug: {
    chatCompletion: () => process.env.DEBUG_PROXYSTACKS_CHAT_COMPLETION === '1',
  },
  id: ModelProvider.ProxyStacks,
  models: async ({ client: openAIClient }) => {
    const modelsPage = (await openAIClient.models.list()) as any;
    const rawList: Array<Record<string, any> & { id: string }> = modelsPage.data || [];

    const modelList = rawList.map((model) => {
      const localCard = model?.id ? LOCAL_MODEL_MAP.get(model.id.toLowerCase()) : undefined;
      if (!localCard) return model;

      return {
        ...model,
        contextWindowTokens:
          model.contextWindowTokens ?? model.context_length ?? localCard.contextWindowTokens,
        description: model.description ?? localCard.description,
        displayName: model.displayName ?? model.display_name ?? localCard.displayName,
        enabled: model.enabled ?? localCard.enabled,
        functionCall: model.functionCall ?? Boolean(localCard.abilities?.functionCall),
        imageOutput: model.imageOutput ?? Boolean(localCard.abilities?.imageOutput),
        maxOutput: model.maxOutput ?? model.max_output_tokens ?? localCard.maxOutput,
        pricing: model.pricing ?? localCard.pricing,
        reasoning: model.reasoning ?? Boolean(localCard.abilities?.reasoning),
        releasedAt: model.releasedAt ?? localCard.releasedAt,
        search: model.search ?? Boolean(localCard.abilities?.search),
        settings: model.settings ?? localCard.settings,
        type: model.type ?? localCard.type,
        video: model.video ?? Boolean(localCard.abilities?.video),
        vision: model.vision ?? Boolean(localCard.abilities?.vision),
      };
    });

    return processMultiProviderModelList(modelList, 'proxystacks');
  },
  routers: (options, runtimeContext?: { model?: string }) => {
    const rootBaseURL = resolveRootBaseURL(options.baseURL);
    const v1BaseURL = urlJoin(rootBaseURL, '/v1');

    return [
      {
        apiType: 'anthropic',
        models: resolveProviderRouteModels(
          'anthropic',
          LOBE_DEFAULT_MODEL_LIST,
          runtimeContext?.model,
        ),
        options: {
          ...options,
          baseURL: rootBaseURL,
        },
      },
      {
        apiType: 'deepseek',
        models: resolveProviderRouteModels(
          'deepseek',
          LOBE_DEFAULT_MODEL_LIST,
          runtimeContext?.model,
        ),
        options: {
          ...options,
          baseURL: v1BaseURL,
          chatCompletion: {
            useResponseModels: RESPONSE_API_MODELS,
          },
          sdkType: 'openai',
        },
      },
      {
        apiType: 'openai',
        options: {
          ...options,
          baseURL: v1BaseURL,
          chatCompletion: {
            useResponseModels: RESPONSE_API_MODELS,
          },
        },
      },
    ];
  },
} satisfies CreateRouterRuntimeOptions;

const BaseProxyStacksAI = createRouterRuntime(params);

export class LobeProxyStacksAI extends BaseProxyStacksAI {
  override async chat(payload: ChatStreamPayload, options?: ChatMethodOptions) {
    const normalizedPayload =
      payload.apiMode === 'responses' && !matchesResponseApiModel(payload.model)
        ? { ...payload, apiMode: 'chatCompletion' as const }
        : payload;

    return super.chat(normalizedPayload, options);
  }
}
