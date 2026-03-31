import type Anthropic from '@anthropic-ai/sdk';
import { ModelProvider } from 'model-bank';

import {
  buildDefaultAnthropicPayload,
  createAnthropicCompatibleParams,
  createAnthropicCompatibleRuntime,
} from '../../core/anthropicCompatibleFactory';
import type { ChatStreamPayload } from '../../types';
import { getModelPropertyWithFallback } from '../../utils/getFallbackModelProperty';
import { processMultiProviderModelList } from '../../utils/modelParse';

const DEFAULT_KIMI_CODING_BASE_URL = 'https://api.kimi.com/coding';

const buildKimiCodingPlanAnthropicPayload = async (
  payload: ChatStreamPayload,
): Promise<Anthropic.MessageCreateParams> => {
  const resolvedMaxTokens =
    payload.max_tokens ??
    (await getModelPropertyWithFallback<number | undefined>(
      payload.model,
      'maxOutput',
      ModelProvider.KimiCodingPlan,
    )) ??
    8192;

  return buildDefaultAnthropicPayload({
    ...payload,
    max_tokens: resolvedMaxTokens,
  });
};

export const params = createAnthropicCompatibleParams({
  baseURL: DEFAULT_KIMI_CODING_BASE_URL,
  chatCompletion: {
    handlePayload: buildKimiCodingPlanAnthropicPayload,
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_KIMI_CODING_PLAN_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const { kimicodingplan } = await import('model-bank');
    return processMultiProviderModelList(
      kimicodingplan.map((m: { id: string }) => ({ id: m.id })),
      'kimicodingplan',
    );
  },
  provider: ModelProvider.KimiCodingPlan,
});

export const LobeKimiCodingPlanAI = createAnthropicCompatibleRuntime(params);

export default LobeKimiCodingPlanAI;
