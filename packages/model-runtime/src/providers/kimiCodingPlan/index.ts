import type Anthropic from '@anthropic-ai/sdk';
import { ModelProvider } from 'model-bank';

import {
  buildDefaultAnthropicPayload,
  createAnthropicCompatibleParams,
  createAnthropicCompatibleRuntime,
} from '../../core/anthropicCompatibleFactory';
import type { ChatStreamPayload } from '../../types';
import { processMultiProviderModelList } from '../../utils/modelParse';

const DEFAULT_KIMI_CODING_BASE_URL = 'https://api.kimi.com/coding';

// Max output tokens for each model (supports both model id and deploymentName)
const KIMI_MODEL_MAX_OUTPUT: Record<string, number> = {
  'k2p5': 32_768,
  'kimi-k2.5': 32_768,
  'kimi-k2-thinking': 65_536,
};

// Helpers for message normalization (shared with Moonshot provider)
const isKimiK25Model = (model: string) => model === 'kimi-k2.5' || model === 'k2p5';
const isKimiNativeThinkingModel = (model: string) => model.startsWith('kimi-k2-thinking');
const isEmptyContent = (content: any) =>
  content === '' || content === null || content === undefined;
const hasValidReasoning = (reasoning: any) => reasoning?.content && !reasoning?.signature;

const getK25Params = (isThinkingEnabled: boolean) => ({
  temperature: isThinkingEnabled ? 1 : 0.6,
  top_p: 0.95,
});

// Anthropic format helpers
const buildThinkingBlock = (reasoning: any) =>
  hasValidReasoning(reasoning) ? { thinking: reasoning.content, type: 'thinking' as const } : null;

const toContentArray = (content: any) =>
  Array.isArray(content) ? content : [{ text: content, type: 'text' as const }];

/**
 * Normalize assistant messages for Anthropic format.
 * When forceThinking is true (kimi-k2.5 with thinking enabled), every assistant
 * message must carry a thinking block, otherwise Kimi API rejects with:
 * "thinking is enabled but reasoning_content is missing in assistant tool call message"
 */
const normalizeMessagesForAnthropic = (
  messages: ChatStreamPayload['messages'],
  forceThinking = false,
) =>
  messages.map((message: any) => {
    if (message.role !== 'assistant') return message;

    const { reasoning, ...rest } = message;
    const thinkingBlock = buildThinkingBlock(reasoning);
    const effectiveBlock =
      thinkingBlock || (forceThinking ? { thinking: ' ', type: 'thinking' as const } : null);

    if (isEmptyContent(message.content)) {
      const placeholder = { text: ' ', type: 'text' as const };
      return { ...rest, content: effectiveBlock ? [effectiveBlock, placeholder] : [placeholder] };
    }

    if (!effectiveBlock) return rest;
    return { ...rest, content: [effectiveBlock, ...toContentArray(message.content)] };
  });

const buildKimiCodingPlanAnthropicPayload = async (
  payload: ChatStreamPayload,
): Promise<Anthropic.MessageCreateParams> => {
  const resolvedMaxTokens = payload.max_tokens ?? KIMI_MODEL_MAX_OUTPUT[payload.model] ?? 8192;

  const isK25 = isKimiK25Model(payload.model);
  const isNativeThinking = isKimiNativeThinkingModel(payload.model);
  const isThinkingEnabled = isNativeThinking || (isK25 && payload.thinking?.type !== 'disabled');

  const basePayload = await buildDefaultAnthropicPayload({
    ...payload,
    max_tokens: resolvedMaxTokens,
    messages: normalizeMessagesForAnthropic(payload.messages, isThinkingEnabled),
  });

  if (!isK25 && !isNativeThinking) return basePayload;

  const resolvedThinkingBudget = payload.thinking?.budget_tokens
    ? Math.min(payload.thinking.budget_tokens, resolvedMaxTokens - 1)
    : 1024;
  const thinkingParam =
    isNativeThinking || payload.thinking?.type !== 'disabled'
      ? ({ budget_tokens: resolvedThinkingBudget, type: 'enabled' } as const)
      : ({ type: 'disabled' } as const);

  return {
    ...basePayload,
    ...getK25Params(thinkingParam.type === 'enabled'),
    thinking: thinkingParam,
  };
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
