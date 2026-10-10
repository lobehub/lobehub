import { LOBE_DEFAULT_MODEL_LIST, ModelProvider } from 'model-bank';
import urlJoin from 'url-join';

import { createRouterRuntime } from '../../core/RouterRuntime';
import type { CreateRouterRuntimeOptions } from '../../core/RouterRuntime/createRuntime';
import { detectModelProvider, processMultiProviderModelList } from '../../utils/modelParse';
import { responsesAPIModels } from '../openai/modelId';
import { resolveProviderRouteModels } from '../utils/resolveProviderRouteModels';

// Default TokenDos gateway
const DEFAULT_BASE_URL = 'https://api.tokendos.com';

const resolveBaseURL = (options: { baseURL?: string | null }) =>
  options.baseURL?.trim().replace(/\/v\d+[a-z]*\/?$/, '') || DEFAULT_BASE_URL;

export const params: CreateRouterRuntimeOptions = {
  debug: {
    chatCompletion: () => process.env.DEBUG_TOKENDOS_CHAT_COMPLETION === '1',
  },
  defaultHeaders: {
    'APP-Code': 'LobeHub',
  },
  id: ModelProvider.TokenDos,
  models: async ({ client }) => {
    const apiKey = (client as any).apiKey as string;
    const clientBaseURL = ((client as any).baseURL as string) || DEFAULT_BASE_URL;
    const rootBaseURL = clientBaseURL.replace(/\/v\d+[a-z]*\/?$/, '') || DEFAULT_BASE_URL;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(urlJoin(rootBaseURL, '/v1/models'), {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      const json = (await response.json()) as { data?: any[] };
      const modelList = json.data || [];
      return await processMultiProviderModelList(modelList, 'tokendos');
    } catch {
      return [];
    } finally {
      clearTimeout(timeoutId);
    }
  },
  routers: (options, runtimeContext) => [
    {
      apiType: 'anthropic',
      models: LOBE_DEFAULT_MODEL_LIST.map((m) => m.id).filter(
        (id) => detectModelProvider(id) === 'anthropic',
      ),
      options: { baseURL: resolveBaseURL(options) },
    },
    {
      apiType: 'google',
      models: LOBE_DEFAULT_MODEL_LIST.map((m) => m.id).filter(
        (id) => detectModelProvider(id) === 'google',
      ),
      options: { baseURL: urlJoin(resolveBaseURL(options), '/v1') },
    },
    {
      apiType: 'xai',
      models: LOBE_DEFAULT_MODEL_LIST.map((m) => m.id).filter(
        (id) => detectModelProvider(id) === 'xai',
      ),
      options: { baseURL: urlJoin(resolveBaseURL(options), '/v1') },
    },
    {
      apiType: 'deepseek',
      models: resolveProviderRouteModels(
        'deepseek',
        LOBE_DEFAULT_MODEL_LIST,
        runtimeContext?.model,
      ),
      options: { baseURL: urlJoin(resolveBaseURL(options), '/v1') },
    },
    {
      apiType: 'openai',
      options: {
        baseURL: urlJoin(resolveBaseURL(options), '/v1'),
        chatCompletion: {
          useResponseModels: [...Array.from(responsesAPIModels), /gpt-\d(?!\d)/, /^o\d/],
        },
      },
    },
  ],
};

export const LobeTokenDosAI = createRouterRuntime(params);
