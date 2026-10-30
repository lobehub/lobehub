import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';

// Models that take no caller thinking toggle on this host
// (docs: https://www.watt-cloud.com/docs/inference/features/deep-thinking).
// Kimi-K2.7-Code always thinks; GLM-5.3 / GLM-5.3-Flash /
// Hy4-preview have no off switch in their first-party templates
// (pending a live audit of chat_template_kwargs.thinking = false).
// All other Watt models toggle thinking via chat_template_kwargs.thinking.
const NO_THINKING_TOGGLE_MODELS = new Set([
  'GLM-5.3',
  'GLM-5.3-Flash',
  'Hy4-preview',
  'Kimi-K2.7-Code',
]);

export interface WattModelCard {
  id: string;
}

export const params = {
  baseURL: 'https://api.watt-cloud.com/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { model, thinking, ...rest } = payload;

      const thinkingFlag =
        thinking?.type === 'enabled' ? true : thinking?.type === 'disabled' ? false : undefined;

      return {
        ...rest,
        model,
        ...(NO_THINKING_TOGGLE_MODELS.has(model) || thinkingFlag === undefined
          ? {}
          : { chat_template_kwargs: { thinking: thinkingFlag } }),
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_WATT_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const rawList: any[] = modelsPage.data || [];

    // Merge fetched IDs against the Watt catalog: matching by Watt's own
    // cards keeps host-level limits (context, max output, pricing) from
    // being overridden by same-name cards of the upstream vendors.
    return await processModelList(rawList, MODEL_LIST_CONFIGS.watt, 'watt');
  },
  provider: ModelProvider.Watt,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeWattAI = createOpenAICompatibleRuntime(params);
