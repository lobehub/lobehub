import { LOBE_DEFAULT_MODEL_LIST, ModelProvider } from 'model-bank';
import urlJoin from 'url-join';

import { createRouterRuntime } from '../../core/RouterRuntime';
import type { CreateRouterRuntimeOptions } from '../../core/RouterRuntime/createRuntime';
import { processMultiProviderModelList } from '../../utils/modelParse';
import { responsesAPIModels } from '../openai/openaiModelId';
import { resolveProviderRouteModels } from '../utils/resolveProviderRouteModels';

type TokenLabModelCategory =
  | 'audio'
  | 'chat'
  | 'embedding'
  | 'image'
  | 'music'
  | 'realtime'
  | 'rerank'
  | 'stt'
  | 'translation'
  | 'tts'
  | 'video'
  | '3d';

interface TokenLabModelCard {
  created?: number;
  id: string;
  lemondata?: TokenLabModelMetadata;
  object: string;
  owned_by?: string;
  tokenlab?: TokenLabModelMetadata;
}

interface TokenLabModelMetadata {
  cache_pricing?: {
    cache_read_per_1m?: string;
  };
  capabilities?: string[];
  category?: TokenLabModelCategory;
  max_input_tokens?: number;
  max_output_tokens?: number;
  pricing?: {
    input_per_1m?: string;
    output_per_1m?: string;
  };
}

const DEFAULT_BASE_URL = 'https://api.tokenlab.sh';
const VERSIONED_PATH_PATTERN = /\/v\d+(?:alpha|beta)?\/?$/;

const TYPE_MAP: Partial<Record<TokenLabModelCategory, string>> = {
  audio: 'asr',
  chat: 'chat',
  embedding: 'embedding',
  image: 'image',
  music: 'text2music',
  realtime: 'realtime',
  stt: 'asr',
  translation: 'chat',
  tts: 'tts',
  video: 'video',
};

const toNumber = (value?: string) => {
  if (value === undefined) return undefined;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const resolveBaseURL = (options: { baseURL?: string | null }) =>
  options.baseURL?.trim().replace(VERSIONED_PATH_PATTERN, '') || DEFAULT_BASE_URL;

const mapTokenLabModel = (model: TokenLabModelCard) => {
  const metadata = model.tokenlab ?? model.lemondata ?? {};
  const category = metadata.category;
  const capabilities = new Set(metadata.capabilities ?? []);
  const input = toNumber(metadata.pricing?.input_per_1m);
  const output = toNumber(metadata.pricing?.output_per_1m);
  const cachedInput = toNumber(metadata.cache_pricing?.cache_read_per_1m);
  const pricing =
    input === undefined && output === undefined && cachedInput === undefined
      ? undefined
      : {
          ...(cachedInput !== undefined && { cachedInput }),
          ...(input !== undefined && { input }),
          ...(output !== undefined && { output }),
        };

  return {
    id: model.id,
    ...(metadata.max_input_tokens !== undefined && {
      contextWindowTokens: metadata.max_input_tokens,
    }),
    ...(metadata.max_output_tokens !== undefined && { maxOutput: metadata.max_output_tokens }),
    ...(model.owned_by && { organization: model.owned_by }),
    ...(pricing && { pricing }),
    ...(category && TYPE_MAP[category] && { type: TYPE_MAP[category] }),
    functionCall: capabilities.has('tool-use'),
    reasoning: capabilities.has('reasoning') || capabilities.has('coding'),
    structuredOutput: capabilities.has('json-mode'),
    vision: capabilities.has('vision'),
  };
};

export const params = {
  debug: {
    chatCompletion: () => process.env.DEBUG_TOKENLAB_CHAT_COMPLETION === '1',
    responses: () => process.env.DEBUG_TOKENLAB_RESPONSES === '1',
  },
  id: ModelProvider.TokenLab,
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: TokenLabModelCard[] = modelsPage.data || [];

    return processMultiProviderModelList(
      modelList.map((model) => mapTokenLabModel(model)),
      'tokenlab',
    );
  },
  routers: (options, runtimeContext) => {
    const baseURL = resolveBaseURL(options);

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
          baseURL,
        },
      },
      {
        apiType: 'google',
        models: resolveProviderRouteModels(
          'google',
          LOBE_DEFAULT_MODEL_LIST,
          runtimeContext?.model,
        ),
        options: {
          ...options,
          baseURL,
        },
      },
      {
        apiType: 'xai',
        models: resolveProviderRouteModels('xai', LOBE_DEFAULT_MODEL_LIST, runtimeContext?.model),
        options: {
          ...options,
          baseURL: urlJoin(baseURL, '/v1'),
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
          baseURL: urlJoin(baseURL, '/v1'),
          sdkType: 'openai',
        },
      },
      {
        apiType: 'openai',
        options: {
          ...options,
          baseURL: urlJoin(baseURL, '/v1'),
          chatCompletion: {
            useResponseModels: [...Array.from(responsesAPIModels), /gpt-\d(?!\d)/, /^o\d/],
          },
        },
      },
    ];
  },
} satisfies CreateRouterRuntimeOptions;

export const LobeTokenLabAI = createRouterRuntime(params);
