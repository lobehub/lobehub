import type Anthropic from '@anthropic-ai/sdk';
import { deepseek as deepseekChatModels, ModelProvider } from 'model-bank';
import type OpenAI from 'openai';

import { buildDefaultAnthropicPayload } from '../../core/anthropicCompatibleFactory';
import type { ChatStreamPayload } from '../../types';
import { getModelPropertyWithFallback } from '../../utils/getFallbackModelProperty';
import { isDeepSeekV4FamilyModel } from '../../utils/modelParse';
import { resolveSafeMaxTokens } from '../../utils/resolveSafeMaxTokens';
import { sanitizeDeepSeekJsonPayload } from './sanitizePayload';

export const isDeepSeekV4Model = (model: string | undefined) => isDeepSeekV4FamilyModel(model);
const isEmptyContent = (content: unknown) =>
  content === '' || content === null || content === undefined;
const hasReasoningContent = (reasoning: any) => typeof reasoning?.content === 'string';

const buildThinkingBlock = (reasoning: any) =>
  hasReasoningContent(reasoning)
    ? { thinking: reasoning.content, type: 'thinking' as const }
    : undefined;

const toContentArray = (content: any) =>
  Array.isArray(content)
    ? content
    : [{ text: isEmptyContent(content) ? ' ' : content, type: 'text' as const }];

const shouldEnableDeepSeekThinking = (payload: ChatStreamPayload) => {
  if (payload.model === 'deepseek-reasoner') return true;
  return isDeepSeekV4Model(payload.model) && payload.thinking?.type !== 'disabled';
};

const resolveDeepSeekThinking = (payload: ChatStreamPayload): ChatStreamPayload['thinking'] => {
  if (payload.model === 'deepseek-reasoner') {
    return {
      budget_tokens: payload.thinking?.budget_tokens ?? 1024,
      type: 'enabled',
    };
  }

  if (isDeepSeekV4Model(payload.model)) {
    if (payload.thinking?.type === 'disabled') {
      return {
        budget_tokens: 0,
        type: 'disabled',
      };
    }

    return {
      budget_tokens: payload.thinking?.budget_tokens ?? 1024,
      type: 'enabled',
    };
  }

  if (payload.thinking?.type === 'enabled' && payload.thinking.budget_tokens === undefined) {
    return {
      budget_tokens: 1024,
      type: 'enabled',
    };
  }

  return payload.thinking;
};

/**
 * DeepSeek's Anthropic-compatible API uses Anthropic content blocks for assistant
 * reasoning history. For V4 thinking mode we keep an explicit placeholder block
 * so follow-up tool-call turns preserve the same reasoning-history guarantee as
 * the OpenAI-compatible API.
 *
 * @see https://api-docs.deepseek.com/guides/anthropic_api
 * @see https://api-docs.deepseek.com/guides/thinking_mode#tool-calls
 */
const normalizeMessagesForAnthropic = (
  messages: ChatStreamPayload['messages'],
  forceThinking = false,
) =>
  messages.map((message: any) => {
    if (message.role !== 'assistant') return message;

    const { reasoning, ...rest } = message;
    const thinkingBlock = buildThinkingBlock(reasoning);
    const effectiveThinkingBlock =
      thinkingBlock || (forceThinking ? { thinking: ' ', type: 'thinking' as const } : undefined);

    if (!effectiveThinkingBlock) return rest;

    return {
      ...rest,
      content: [effectiveThinkingBlock, ...toContentArray(message.content)],
    };
  });

export const buildDeepSeekAnthropicPayload = async (
  payload: ChatStreamPayload,
): Promise<Anthropic.MessageCreateParams> => {
  const resolvedThinking = resolveDeepSeekThinking(payload);
  const isThinkingDisabled = resolvedThinking?.type === 'disabled';

  const anthropicMessages = normalizeMessagesForAnthropic(
    payload.messages,
    shouldEnableDeepSeekThinking(payload),
  );

  const resolvedMaxTokens =
    payload.max_tokens ??
    // Cap the completion budget against the actual input size instead of always
    // reserving the model's full `maxOutput`. DeepSeek-v4-pro reserves 384k for
    // completion; with a prompt that on its own fits the 1M window, that fixed
    // reservation tipped the total over the limit and produced a "phantom"
    // ExceededContextWindow. resolveSafeMaxTokens shrinks the reservation to the
    // remaining room, and fails fast with a structured ContextExceededPreFlight
    // error when the prompt leaves less than ~1k tokens for completion (below
    // deepseek-v4's default thinking budget → effectively context-full) — which
    // is more actionable (fork_topic / larger-ctx suggestions) than either a
    // doomed upstream 400 or a truncated stub completion. Estimate against the
    // messages we actually send (anthropic-normalized).
    resolveSafeMaxTokens({ ...payload, messages: anthropicMessages }, deepseekChatModels) ??
    (await getModelPropertyWithFallback<number | undefined>(
      payload.model,
      'maxOutput',
      ModelProvider.DeepSeek,
    )) ??
    (resolvedThinking?.type === 'enabled' ? 32_000 : 64_000);

  const basePayload = await buildDefaultAnthropicPayload({
    ...payload,
    effort: !isThinkingDisabled ? ((payload.effort ?? payload.reasoning_effort) as any) : undefined,
    max_tokens: resolvedMaxTokens,
    messages: anthropicMessages,
    thinking: isThinkingDisabled ? undefined : resolvedThinking,
  });

  return sanitizeDeepSeekJsonPayload({
    ...basePayload,
    ...(basePayload.temperature !== undefined && payload.temperature !== undefined
      ? { temperature: payload.temperature }
      : {}),
    ...(isThinkingDisabled ? { thinking: { type: 'disabled' } } : {}),
  } as Anthropic.MessageCreateParams);
};

export const buildDeepSeekOpenAIPayload = (
  payload: ChatStreamPayload,
): OpenAI.ChatCompletionCreateParamsStreaming => {
  // deepseek-v4-* defaults to thinking=enabled unless the caller explicitly
  // sets thinking.type === 'disabled'. In thinking mode the API rejects
  // (HTTP 400) follow-up turns that omit reasoning_content on assistant
  // messages with tool calls — see
  // https://api-docs.deepseek.com/guides/thinking_mode#tool-calls
  const isV4Model = typeof payload.model === 'string' && isDeepSeekV4Model(payload.model);
  const thinkingExplicitlyDisabled = payload.thinking?.type === 'disabled';
  const shouldForceAssistantReasoningContent =
    payload.model === 'deepseek-reasoner' || (isV4Model && !thinkingExplicitlyDisabled);

  // Transform reasoning object to reasoning_content string for multi-turn conversations
  const messages = payload.messages.map((message: any) => {
    const { reasoning, ...rest } = message;

    const reasoningContent =
      typeof rest.reasoning_content === 'string'
        ? rest.reasoning_content
        : typeof reasoning?.content === 'string'
          ? reasoning.content
          : undefined;

    // DeepSeek thinking mode with tool calls requires assistant history
    // messages to carry reasoning_content, or the API returns a 400.
    if (message.role === 'assistant' && shouldForceAssistantReasoningContent) {
      return {
        ...rest,
        reasoning_content: reasoningContent ?? '',
      };
    }

    if (reasoningContent !== undefined) {
      return {
        ...rest,
        reasoning_content: reasoningContent,
      };
    }

    return rest;
  });

  // DeepSeek rejects `reasoning_effort` when thinking is explicitly disabled.
  const { reasoning_effort, thinking, ...restPayload } = payload;

  return sanitizeDeepSeekJsonPayload({
    ...restPayload,
    messages,
    ...(!thinkingExplicitlyDisabled && reasoning_effort && { reasoning_effort }),
    ...(thinking?.type === 'enabled' || thinking?.type === 'disabled'
      ? { thinking: { type: thinking.type } }
      : {}),
    stream: payload.stream ?? true,
  } as OpenAI.ChatCompletionCreateParamsStreaming);
};
