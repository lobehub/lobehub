import { LOBE_DEFAULT_MODEL_LIST, ModelProvider } from 'model-bank';

import { createRouterRuntime } from '../../core/RouterRuntime';
import type { CreateRouterRuntimeOptions } from '../../core/RouterRuntime/createRuntime';
import { registerModelPricingResolver } from '../../utils/getModelPricing';
import { resolveProviderRouteModels } from '../utils/resolveProviderRouteModels';
import {
  DOTHOOSH_BASE_URL,
  fetchDotHooshCatalog,
  getDotHooshLivePricing,
  getDotHooshRoutingCatalog,
  resolveAnthropicBaseURL,
} from './catalog';
import type { DotHooshCatalog } from './parseModels';
import { buildRouteTable, parseDotHooshModels } from './parseModels';

export { resolveAnthropicBaseURL };

// Usage is priced from DotHoosh's own live catalog, never from another provider's card with the same id.
registerModelPricingResolver(ModelProvider.DotHoosh, (model) => getDotHooshLivePricing(model));

// A chat whose route cannot be read from the live or last good catalog is refused rather than guessed.
const assertRouteKnown = (
  model: string,
  catalog: DotHooshCatalog,
  unresolved: Array<keyof DotHooshCatalog>,
) => {
  if (unresolved.includes('openai')) {
    throw new Error(`DotHoosh could not load its model list, so the route for ${model} is unknown`);
  }
  if (unresolved.includes('anthropic') && !catalog.openai.some((item) => item.id === model)) {
    throw new Error(
      `DotHoosh could not load its Anthropic model list, so the route for ${model} is unknown`,
    );
  }
};

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
    const model = runtimeContext?.model;
    const { catalog, unresolved } = await getDotHooshRoutingCatalog({
      apiKey: options.apiKey ?? undefined,
      baseURL: options.baseURL ?? undefined,
    }).catch((error) => {
      if (model) throw error;
      console.error('[DotHoosh] Failed to load the catalog for routing:', error);
      return { catalog: { anthropic: [], openai: [] }, unresolved: [] };
    });
    if (model) assertRouteKnown(model, catalog, unresolved);
    const table = buildRouteTable(catalog);

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
