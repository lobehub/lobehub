import type Anthropic from '@anthropic-ai/sdk';

import { stripUnsupportedClaudeAssistantPrefill } from '../../../providers/anthropic/claudePrefill';
import { rejectsDisabledThinkingAtEffort } from '../../../providers/anthropic/modelId';
import type { ChatStreamPayload } from '../../../types';
import { resolveModelSamplingParameters } from '../../parameterResolver';
import { type ComputeChatCostOptions } from '../../usageConverters/utils/computeChatCost';
import { buildAnthropicMessages, buildAnthropicTools, buildSearchTool } from './messages';
import { resolveCacheTTL } from './resolveCacheTTL';
import { resolveMaxTokens } from './resolveMaxTokens';
import { resolveClaudeThinkingConfig } from './resolveThinkingConfig';

type AnthropicTools = Anthropic.Tool | Anthropic.WebSearchTool20250305;

/**
 * Build the default Anthropic Messages payload with LobeChat normalization.
 */
export const buildDefaultAnthropicPayload = async (
  payload: ChatStreamPayload,
): Promise<Anthropic.MessageCreateParams> => {
  const {
    messages,
    model,
    max_tokens,
    temperature,
    top_p,
    tools,
    thinking,
    effort,
    enabledContextCaching = true,
    enabledSearch,
  } = payload;

  const { anthropic: anthropicModels } = await import('model-bank');

  const resolvedMaxTokens = await resolveMaxTokens({
    max_tokens,
    model,
    providerModels: anthropicModels,
    thinking,
  });

  // Filter out empty/whitespace-only system prompts — Anthropic API rejects them
  const systemMessage = messages.find((message) => message.role === 'system');
  const userMessages = messages.filter((message) => message.role !== 'system');
  const systemPromptText =
    typeof systemMessage?.content === 'string' && systemMessage.content.trim()
      ? systemMessage.content
      : undefined;

  const systemPrompts = systemPromptText
    ? ([
        {
          cache_control: enabledContextCaching ? { type: 'ephemeral' } : undefined,
          text: systemPromptText,
          type: 'text',
        },
      ] as Anthropic.TextBlockParam[])
    : undefined;

  const postMessages = stripUnsupportedClaudeAssistantPrefill(
    model,
    await buildAnthropicMessages(userMessages, { enabledContextCaching }),
  );

  let postTools = buildAnthropicTools(tools, { enabledContextCaching }) as
    AnthropicTools[] | undefined;

  if (enabledSearch) {
    const webSearchTool = buildSearchTool();
    postTools = postTools?.length ? [...postTools, webSearchTool] : [webSearchTool];
  }

  const resolvedThinking = resolveClaudeThinkingConfig({
    maxTokens: resolvedMaxTokens,
    model,
    thinking,
  });

  if (resolvedThinking && resolvedThinking.type !== 'disabled') {
    return {
      max_tokens: resolvedMaxTokens,
      messages: postMessages,
      model,
      ...(effort ? { output_config: { effort } } : {}),
      system: systemPrompts,
      thinking: resolvedThinking as Anthropic.MessageCreateParams['thinking'],
      tools: postTools as Anthropic.MessageCreateParams['tools'],
    } as Anthropic.MessageCreateParams;
  }

  // Resolve temperature/top_p: Claude 4+ doesn't allow both simultaneously.
  // normalizeTemperature divides by 2 to map LobeChat's 0-2 range to Anthropic's 0-1 range.
  const resolvedSamplingParams = resolveModelSamplingParameters(
    model,
    { temperature, top_p },
    { normalizeTemperature: true, preferTemperature: true },
  );

  // Claude Opus 5 and later reject disabled thinking at effort `xhigh` / `max`; every lower
  // effort level stays valid, so only that pairing is dropped.
  const forwardsEffort =
    !!effort &&
    !(resolvedThinking?.type === 'disabled' && rejectsDisabledThinkingAtEffort(model, effort));

  // Support effort parameter even without thinking (per Claude 4.6 guidance)
  const basePayload: Anthropic.MessageCreateParams = {
    max_tokens: resolvedMaxTokens,
    messages: postMessages,
    model,
    system: systemPrompts,
    temperature: resolvedSamplingParams.temperature,
    tools: postTools as Anthropic.MessageCreateParams['tools'],
    ...(resolvedThinking
      ? { thinking: resolvedThinking as Anthropic.MessageCreateParams['thinking'] }
      : {}),
    top_p: resolvedSamplingParams.top_p,
  };

  // If effort is specified without an incompatible thinking mode, add output_config
  if (forwardsEffort) {
    return {
      ...basePayload,
      output_config: { effort },
    } as Anthropic.MessageCreateParams;
  }

  return basePayload;
};

const toPricingOptions = (cacheTTL: string | undefined): ComputeChatCostOptions | undefined =>
  cacheTTL ? { lookupParams: { ttl: cacheTTL } } : undefined;

/**
 * Resolve cache-aware pricing options for usage cost calculation on a Messages-compatible
 * provider. It reports only a TTL the request states, never Anthropic's implicit default: see
 * {@link resolveAnthropicPricingOptions} for Anthropic's own cache.
 */
export const resolveDefaultAnthropicPricingOptions = (
  requestPayload: ChatStreamPayload,
  anthropicPayload: Anthropic.MessageCreateParams,
): ComputeChatCostOptions | undefined =>
  toPricingOptions(
    resolveCacheTTL(requestPayload, {
      messages: anthropicPayload.messages,
      system: anthropicPayload.system,
    }),
  );

/**
 * Pricing options for Anthropic's own cache, where a `cache_control` block without a TTL lives
 * for the default 5 minutes. The TTL also becomes the message's recorded prompt cache lifetime.
 */
export const resolveAnthropicPricingOptions = (
  requestPayload: ChatStreamPayload,
  anthropicPayload: Anthropic.MessageCreateParams,
): ComputeChatCostOptions | undefined =>
  toPricingOptions(
    resolveCacheTTL(
      requestPayload,
      { messages: anthropicPayload.messages, system: anthropicPayload.system },
      { anthropicCache: true },
    ),
  );
