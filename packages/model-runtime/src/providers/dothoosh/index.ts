import { LOBE_DEFAULT_MODEL_LIST, ModelProvider } from 'model-bank';

import { createRouterRuntime } from '../../core/RouterRuntime';
import type { CreateRouterRuntimeOptions } from '../../core/RouterRuntime/createRuntime';
import { resolveProviderRouteModels } from '../utils/resolveProviderRouteModels';
import {
  DOTHOOSH_BASE_URL,
  fetchDotHooshCatalog,
  getDotHooshCatalog,
  resolveAnthropicBaseURL,
} from './catalog';
import { buildRouteTable, parseDotHooshModels } from './parseModels';

export { resolveAnthropicBaseURL };

const escapeRegExp = (value: string) => value.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);

// `useResponseModels` matches by substring, so anchor each id.
const exactIdPatterns = (ids: string[]) => ids.map((id) => new RegExp(`^${escapeRegExp(id)}$`));

export const params = {
  debug: {
    chatCompletion: () => process.env.DEBUG_DOTHOOSH_CHAT_COMPLETION === '1',
  },
  id: ModelProvider.DotHoosh,
  // Models, limits and prices are read live from the gateway, never from a static list.
  models: async ({ options }) =>
    parseDotHooshModels(
      await fetchDotHooshCatalog({
        apiKey: options?.apiKey ?? undefined,
        baseURL: options?.baseURL ?? undefined,
      }),
    ),
  // Routing comes from the live catalog, not from id prefixes: a model listed on the Anthropic
  // route (and not on Chat Completions) goes to the Anthropic runtime, one whose protocols[] offer
  // the Responses API goes to the OpenAI Responses API (GPT-6 takes function tools only there),
  // everything else to Chat Completions.
  routers: async (options, runtimeContext?: { model?: string }) => {
    const baseURL = options.baseURL || DOTHOOSH_BASE_URL;
    const table = buildRouteTable(
      await getDotHooshCatalog({
        apiKey: options.apiKey ?? undefined,
        baseURL: options.baseURL ?? undefined,
      }).catch((error) => {
        console.error('[DotHoosh] Failed to load the catalog for routing:', error);
        return { anthropic: [], openai: [] };
      }),
    );

    return [
      {
        apiType: 'anthropic',
        models: table.anthropic,
        options: { ...options, baseURL: resolveAnthropicBaseURL(baseURL) },
      },
      {
        apiType: 'openai',
        models: table.responses,
        options: {
          ...options,
          baseURL,
          chatCompletion: { useResponseModels: exactIdPatterns(table.responses) },
          generateObject: { useResponseModels: exactIdPatterns(table.responses) },
        },
      },
      // The deepseek runtime adapts DeepSeek's reasoning stream; LobeHub's own DeepSeek ids pick it.
      {
        apiType: 'deepseek',
        models: resolveProviderRouteModels(
          'deepseek',
          LOBE_DEFAULT_MODEL_LIST,
          runtimeContext?.model,
        ),
        options: { ...options, baseURL, sdkType: 'openai' },
      },
      // OpenAI Chat Completions for everything else (Gemini, Kimi, any new vendor).
      {
        apiType: 'openai',
        options: { ...options, baseURL },
      },
    ];
  },
} satisfies CreateRouterRuntimeOptions;

export const LobeDotHooshAI = createRouterRuntime(params);
