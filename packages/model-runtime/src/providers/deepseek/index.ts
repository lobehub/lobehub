import { deepseek as deepseekChatModels, ModelProvider } from 'model-bank';

import {
  createAnthropicCompatibleParams,
  createAnthropicCompatibleRuntime,
} from '../../core/anthropicCompatibleFactory';
import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import type { CreateRouterRuntimeOptions } from '../../core/RouterRuntime';
import { createRouterRuntime } from '../../core/RouterRuntime';
import { buildDeepSeekAnthropicPayload, buildDeepSeekOpenAIPayload } from './chatPayload';
import {
  buildDeepSeekGenerateObjectPayload,
  createDeepSeekAnthropicGenerateObject,
} from './generateObject';
import { fetchDeepSeekModels } from './modelFetch';

const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';
const DEFAULT_DEEPSEEK_ANTHROPIC_BASE_URL = 'https://api.deepseek.com/anthropic';
const DEEPSEEK_ANTHROPIC_BASE_URL_PATTERN = /\/anthropic\/?$/;
const DEEPSEEK_ANTHROPIC_MESSAGES_PATH_PATTERN = /\/v1\/messages\/?$/;

type DeepSeekSDKType = 'anthropic' | 'openai';

const normalizeDeepSeekAnthropicBaseURL = (baseURL?: string | null) =>
  baseURL?.replace(DEEPSEEK_ANTHROPIC_MESSAGES_PATH_PATTERN, '');

/**
 * `sdkType` explicitly selects the DeepSeek SDK wrapper for router-runtime channels.
 * Legacy baseURL suffix matching is only kept for existing configs that have not set it.
 */
const resolveDeepSeekSDKType = (sdkType: unknown): DeepSeekSDKType | undefined => {
  if (sdkType === undefined || sdkType === null || sdkType === '') return undefined;
  if (sdkType === 'anthropic' || sdkType === 'openai') return sdkType;

  throw new Error(`Unsupported DeepSeek sdkType: ${String(sdkType)}`);
};

export const anthropicParams = createAnthropicCompatibleParams({
  baseURL: DEFAULT_DEEPSEEK_ANTHROPIC_BASE_URL,
  chatCompletion: {
    handlePayload: buildDeepSeekAnthropicPayload,
  },
  customClient: {},
  debug: {
    chatCompletion: () => process.env.DEBUG_DEEPSEEK_CHAT_COMPLETION === '1',
  },
  generateObject: createDeepSeekAnthropicGenerateObject,
  provider: ModelProvider.DeepSeek,
});

export const LobeDeepSeekAnthropicAI = createAnthropicCompatibleRuntime(anthropicParams);

export const openAIParams = {
  baseURL: DEFAULT_DEEPSEEK_BASE_URL,
  chatCompletion: {
    // DeepSeek upstream rejects requests where input alone exceeds the
    // model context window with a 400 carrying `max_completion=0` in the
    // message. Fail fast before round-tripping. See LOBE-8974.
    contextPreFlight: { models: deepseekChatModels },
    handlePayload: buildDeepSeekOpenAIPayload,
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_DEEPSEEK_CHAT_COMPLETION === '1',
  },
  // Deepseek don't support json format well
  // use Tools calling to simulate
  generateObject: {
    handlePayload: buildDeepSeekGenerateObjectPayload,
    useToolsCalling: true,
  },
  models: fetchDeepSeekModels,
  provider: ModelProvider.DeepSeek,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeDeepSeekOpenAI = createOpenAICompatibleRuntime(openAIParams);

const createOpenAIRouter = (baseURLPattern?: RegExp) => ({
  apiType: 'deepseek' as const,
  ...(baseURLPattern ? { baseURLPattern } : {}),
  id: 'openai-compatible',
  options: { remark: 'openai-compatible' },
  runtime: LobeDeepSeekOpenAI,
});

const createAnthropicRouter = ({
  baseURL,
  baseURLPattern,
}: {
  baseURL?: string;
  baseURLPattern?: RegExp;
} = {}) => ({
  apiType: 'deepseek' as const,
  ...(baseURLPattern ? { baseURLPattern } : {}),
  id: 'anthropic-compatible',
  options: {
    ...(baseURL ? { baseURL } : {}),
    remark: 'anthropic-compatible',
  },
  runtime: LobeDeepSeekAnthropicAI,
});

export const params: CreateRouterRuntimeOptions = {
  id: ModelProvider.DeepSeek,
  models: fetchDeepSeekModels,
  routers: (options) => {
    const sdkType = resolveDeepSeekSDKType(options.sdkType);

    if (sdkType === 'anthropic') {
      return [
        createAnthropicRouter({
          baseURL: normalizeDeepSeekAnthropicBaseURL(options.baseURL),
        }),
      ];
    }

    if (sdkType === 'openai') {
      return [createOpenAIRouter()];
    }

    return [
      createOpenAIRouter(/^(?!.*\/anthropic\/?$).+$/),
      createAnthropicRouter({ baseURLPattern: DEEPSEEK_ANTHROPIC_BASE_URL_PATTERN }),
    ];
  },
};

export const LobeDeepSeekAI = createRouterRuntime(params);
