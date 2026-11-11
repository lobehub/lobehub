import type Anthropic from '@anthropic-ai/sdk';
import type { Pricing } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatible';
import type { AnthropicGenerateObjectConfig } from '../../core/protocols/anthropicMessages/generateObject';
import { createAnthropicGenerateObject } from '../../core/protocols/anthropicMessages/generateObject';
import type { ChatStreamPayload, GenerateObjectOptions, GenerateObjectPayload } from '../../types';
import { isDeepSeekV4Model } from './chatPayload';
import { sanitizeDeepSeekJsonPayload } from './sanitizePayload';

type GenerateObjectHandlePayload = NonNullable<
  NonNullable<OpenAICompatibleFactoryOptions['generateObject']>['handlePayload']
>;

const getGenerateObjectThinkingType = (payload: GenerateObjectPayload) =>
  (payload as GenerateObjectPayload & { thinking?: ChatStreamPayload['thinking'] }).thinking?.type;

export const createDeepSeekAnthropicGenerateObject = async (
  client: Anthropic,
  payload: GenerateObjectPayload,
  options?: GenerateObjectOptions,
  pricing?: Pricing,
  config?: AnthropicGenerateObjectConfig,
) => {
  // DeepSeek's Anthropic-compatible endpoint only accepts `auto` / `none` (or
  // no) tool_choice while thinking is active; `any` and a named tool both 400
  // with "Thinking mode does not support this tool_choice". `any` used to be
  // accepted until 2026-11-02 07:17 UTC, when it started failing every
  // structured-output request on V4 models, which default to thinking enabled
  // server-side. So:
  // - V4: disable thinking explicitly unless the caller enabled it, and force
  //   the schema tool (mirrors `buildDeepSeekGenerateObjectPayload`).
  // - Thinking active (caller-enabled V4, thinking-only deepseek-reasoner):
  //   use `auto` plus a prompt instruction instead of a forced tool_choice.
  // - Tools mode (several caller tools, e.g. the group-chat supervisor): the
  //   endpoint now treats `any` as `auto` even with thinking disabled, so it no
  //   longer forces a call. Send `auto` plus the "call one of the tools"
  //   instruction regardless of thinking.
  //   https://api-docs.deepseek.com/guides/anthropic_api#tool_choice
  // Check the mapped request model too: a router can map a logical id to the
  // upstream V4 id.
  const modelIds = [payload.model, config?.requestModel];
  const isV4 = modelIds.some((id) => isDeepSeekV4Model(id));
  const isThinkingOnly = modelIds.some((id) => !!id && id.includes('deepseek-reasoner'));
  const thinkingType = getGenerateObjectThinkingType(payload);
  const thinkingDisabled = isV4 ? thinkingType !== 'enabled' : thinkingType === 'disabled';
  const thinkingActive = !thinkingDisabled && (isV4 || isThinkingOnly);

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
    autoToolChoice: thinkingActive || !!payload.tools,
    requestParams,
    schemaToolChoice: 'tool',
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
