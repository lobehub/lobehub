import type Anthropic from '@anthropic-ai/sdk';
import type { Pricing } from 'model-bank';

import type { AnthropicGenerateObjectConfig } from '../../core/anthropicCompatibleFactory/generateObject';
import { createAnthropicGenerateObject } from '../../core/anthropicCompatibleFactory/generateObject';
import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import type { ChatStreamPayload, GenerateObjectOptions, GenerateObjectPayload } from '../../types';
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
) => {
  // DeepSeek V4 thinking mode rejects Anthropic's named schema tool choice,
  // e.g. `{ type: "tool", name: "task_topic_handoff" }`, but accepts
  // `{ type: "any" }`. If thinking is already disabled, keep the stricter
  // named tool choice; otherwise use `any` without changing the thinking mode.
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
    requestParams,
    schemaToolChoice: thinkingDisabled ? 'tool' : 'any',
  });
};

export const buildDeepSeekGenerateObjectPayload: GenerateObjectHandlePayload = (
  payload,
  requestPayload,
) => {
  const { thinking } = payload;
  const thinkingExplicitlyDisabled = thinking?.type === 'disabled';
  const payloadWithoutReasoningEffort = { ...requestPayload };
  delete (payloadWithoutReasoningEffort as { reasoning_effort?: unknown }).reasoning_effort;

  return sanitizeDeepSeekJsonPayload({
    ...(thinkingExplicitlyDisabled ? payloadWithoutReasoningEffort : requestPayload),
    ...(thinking?.type === 'enabled' || thinkingExplicitlyDisabled
      ? { thinking: { type: thinking.type } }
      : {}),
  });
};
