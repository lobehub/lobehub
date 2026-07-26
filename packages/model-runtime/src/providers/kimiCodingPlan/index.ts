import type Anthropic from '@anthropic-ai/sdk';
import { ModelProvider } from 'model-bank';

import {
  buildDefaultAnthropicPayload,
  createAnthropicCompatibleParams,
  createAnthropicCompatibleRuntime,
} from '../../core/anthropicCompatibleFactory';
import type { ChatStreamPayload } from '../../types';

const DEFAULT_KIMI_CODING_BASE_URL = 'https://api.kimi.com/coding';

// Max output tokens for each model (supports both model id and deploymentName)
// Ref: models.dev → kimi-for-coding.limit.output
const KIMI_MODEL_MAX_OUTPUT: Record<string, number> = {
  'k2p5': 32_768,
  'k2p6': 32_768,
  'k2p7': 32_768,
  'k3': 131_072,
  'kimi-for-coding': 32_768,
  'kimi-for-coding-highspeed': 32_768,
  'kimi-k2.5': 32_768,
  'kimi-k2.6': 32_768,
  'kimi-k2-thinking': 32_768,
};

// Toggleable thinking models (models.dev reasoning_options includes type:toggle)
const isKimiToggleThinkingModel = (model: string) =>
  model === 'k2p5' ||
  model === 'k2p6' ||
  model === 'k3' ||
  model === 'kimi-k2.5' ||
  model === 'kimi-k2.6' ||
  model === 'kimi-for-coding';

// Native always-on thinking (no toggle in models.dev reasoning_options)
const isKimiNativeThinkingModel = (model: string) =>
  model === 'k2p7' || model === 'kimi-for-coding-highspeed' || model.startsWith('kimi-k2-thinking');

const isKimiThinkingModel = (model: string) =>
  isKimiToggleThinkingModel(model) || isKimiNativeThinkingModel(model);
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

  const isNativeThinking = isKimiNativeThinkingModel(payload.model);
  const isThinkingEnabled =
    isNativeThinking ||
    (isKimiToggleThinkingModel(payload.model) && payload.thinking?.type !== 'disabled');

  const basePayload = await buildDefaultAnthropicPayload({
    ...payload,
    max_tokens: resolvedMaxTokens,
    messages: normalizeMessagesForAnthropic(payload.messages, isThinkingEnabled),
  });

  if (!isKimiThinkingModel(payload.model)) {
    const { thinking: _thinking, ...rest } = basePayload;
    return rest;
  }

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
    const { resolveModelsDevModelList } = await import('../utils/modelsDev');
    return resolveModelsDevModelList({
      bankModels: kimicodingplan,
      client,
      modelsDevProvider: 'kimi-for-coding',
      providerId: 'kimicodingplan',
    });
  },
  provider: ModelProvider.KimiCodingPlan,
});

export const LobeKimiCodingPlanAI = createAnthropicCompatibleRuntime(params);

export default LobeKimiCodingPlanAI;
