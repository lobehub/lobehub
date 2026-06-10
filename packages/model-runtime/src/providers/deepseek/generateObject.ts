import type Anthropic from '@anthropic-ai/sdk';
import type { Pricing } from 'model-bank';

import type { AnthropicGenerateObjectConfig } from '../../core/anthropicCompatibleFactory/generateObject';
import { createAnthropicGenerateObject } from '../../core/anthropicCompatibleFactory/generateObject';
import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import type { ChatStreamPayload, GenerateObjectOptions, GenerateObjectPayload } from '../../types';
import { isDeepSeekV4Model } from './chatPayload';
import { sanitizeDeepSeekJsonPayload } from './sanitizePayload';

type GenerateObjectHandlePayload = NonNullable<
  NonNullable<OpenAICompatibleFactoryOptions['generateObject']>['handlePayload']
>;

const isGenerateObjectThinkingEnabled = (payload: GenerateObjectPayload) =>
  (payload as GenerateObjectPayload & { thinking?: ChatStreamPayload['thinking'] }).thinking
    ?.type === 'enabled';

export const createDeepSeekAnthropicGenerateObject = async (
  client: Anthropic,
  payload: GenerateObjectPayload,
  options?: GenerateObjectOptions,
  pricing?: Pricing,
) => {
  // DeepSeek's Anthropic-compatible endpoint enforces Anthropic's extended
  // thinking restriction on tool_choice: while thinking is active, both the
  // named schema tool choice and `{ type: "any" }` are rejected with
  // `400 Thinking mode does not support this tool_choice`. V4 models default
  // to thinking enabled server-side, so structured output (which relies on a
  // forced tool call) must explicitly disable thinking unless the caller
  // turned it on; in that case fall back to `auto`, the only tool_choice
  // thinking mode accepts. deepseek-reasoner is thinking-only.
  const thinkingActive =
    payload.model === 'deepseek-reasoner' || isGenerateObjectThinkingEnabled(payload);
  const requestParams: AnthropicGenerateObjectConfig['requestParams'] = thinkingActive
    ? {
        ...(payload.reasoning_effort
          ? {
              output_config: {
                effort: payload.reasoning_effort as NonNullable<
                  Anthropic.MessageCreateParams['output_config']
                >['effort'],
              },
            }
          : {}),
      }
    : { thinking: { type: 'disabled' } };

  const sanitizedClient = {
    ...client,
    messages: {
      ...client.messages,
      create: (params: Anthropic.MessageCreateParams, requestOptions?: Anthropic.RequestOptions) =>
        client.messages.create(sanitizeDeepSeekJsonPayload(params), requestOptions),
    },
  } as Anthropic;

  return createAnthropicGenerateObject(sanitizedClient, payload, options, pricing, {
    requestParams,
    schemaToolChoice: thinkingActive ? 'auto' : 'tool',
  });
};

export const buildDeepSeekGenerateObjectPayload: GenerateObjectHandlePayload = (
  payload,
  requestPayload,
) => {
  const { thinking } = payload;
  const thinkingEnabled = thinking?.type === 'enabled';
  const payloadWithoutReasoningEffort = { ...requestPayload };
  delete (payloadWithoutReasoningEffort as { reasoning_effort?: unknown }).reasoning_effort;

  // V4 models default to thinking enabled server-side, and thinking mode
  // rejects the forced tool_choice used for structured output (mirrors the
  // Anthropic-compatible endpoint behavior). Explicitly disable thinking
  // unless the caller turned it on. deepseek-reasoner is thinking-only, so
  // leave its thinking parameter untouched.
  if (isDeepSeekV4Model(payload.model)) {
    return sanitizeDeepSeekJsonPayload(
      thinkingEnabled
        ? { ...requestPayload, thinking: { type: 'enabled' } }
        : { ...payloadWithoutReasoningEffort, thinking: { type: 'disabled' } },
    );
  }

  const thinkingExplicitlyDisabled = thinking?.type === 'disabled';

  return sanitizeDeepSeekJsonPayload({
    ...(thinkingExplicitlyDisabled ? payloadWithoutReasoningEffort : requestPayload),
    ...(thinkingEnabled || thinkingExplicitlyDisabled
      ? { thinking: { type: thinking!.type } }
      : {}),
  });
};
