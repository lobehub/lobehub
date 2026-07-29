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

const isGenerateObjectThinkingDisabled = (payload: GenerateObjectPayload) =>
  (payload as GenerateObjectPayload & { thinking?: ChatStreamPayload['thinking'] }).thinking
    ?.type === 'disabled';

export const createDeepSeekAnthropicGenerateObject = async (
  client: Anthropic,
  payload: GenerateObjectPayload,
  options?: GenerateObjectOptions,
  pricing?: Pricing,
  config?: AnthropicGenerateObjectConfig,
) => {
  // DeepSeek's Anthropic-compatible endpoint rejects named schema tool_choice
  // while thinking is active, but accepts `{ type: "any" }`. V4 models may
  // default to thinking enabled server-side, so keep `any` unless the caller
  // explicitly disabled thinking; with a single schema tool it still forces
  // structured output.
  const thinkingDisabled = isGenerateObjectThinkingDisabled(payload);
  const requestParams: AnthropicGenerateObjectConfig['requestParams'] = {
    ...(!thinkingDisabled && payload.reasoning_effort
      ? {
          output_config: {
            effort: payload.reasoning_effort as NonNullable<
              Anthropic.MessageCreateParams['output_config']
            >['effort'],
          },
        }
      : {}),
    ...(thinkingDisabled ? { thinking: { type: 'disabled' } } : {}),
  };

  const sanitizedClient = {
    ...client,
    messages: {
      ...client.messages,
      create: (params: Anthropic.MessageCreateParams, requestOptions?: Anthropic.RequestOptions) =>
        client.messages.create(sanitizeDeepSeekJsonPayload(params), requestOptions),
    },
  } as Anthropic;

  return createAnthropicGenerateObject(sanitizedClient, payload, options, pricing, {
    requestModel: config?.requestModel,
    requestParams,
    schemaToolChoice: thinkingDisabled ? 'tool' : 'any',
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
