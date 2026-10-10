import { CURRENT_VERSION } from '@lobechat/const';
import { ModelProvider } from 'model-bank';
import OpenAI from 'openai';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { params as openAIParams } from '../openai';

const CHATGPT_CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const CHATGPT_RESPONSES_LITE_HEADER = 'x-openai-internal-codex-responses-lite';
const CHATGPT_RESPONSES_LITE_MODEL_IDS = new Set(['gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra']);
const USER_AGENT = `LobeHub/${CURRENT_VERSION}`;

interface ChatGPTClientOptions {
  chatgptAccountId?: string;
}

interface ChatGPTAdditionalToolsInput {
  role: 'developer';
  tools: OpenAI.Responses.Tool[];
  type: 'additional_tools';
}

const isResponsesLiteModel = (model: string | undefined) =>
  !!model && CHATGPT_RESPONSES_LITE_MODEL_IDS.has(model);

/**
 * Codex models that accept the `reasoning.mode` parameter. Mirrors the
 * `reasoningMode` extend-param declarations in the model bank (`gpt-5.6-*`):
 * every other Codex model — GPT-6.x included — rejects the field with
 * `400 reasoning.mode is not supported with this model` (invalid_request_error,
 * unsupported_value), which leaves a callSubAgent run with no way to recover.
 *
 * A stale `agencyConfig.subagent.chatConfig.reasoningMode` configured for one
 * override model must not reach a model that no longer declares the param, so
 * the provider strips it as a final capability gate regardless of where the
 * field leaked in from. The gate runs in `prepareRequest`, i.e. after
 * `modelIdMapping` has resolved the logical model to the actual upstream model
 * ID, so capability is judged against the model the request really targets.
 */
const CHATGPT_REASONING_MODE_MODEL_PREFIXES = ['gpt-5.6-'];

const supportsReasoningMode = (model: string | undefined) =>
  !!model && CHATGPT_REASONING_MODE_MODEL_PREFIXES.some((prefix) => model.startsWith(prefix));

export const LobeChatGPTAI = createOpenAICompatibleRuntime<ChatGPTClientOptions>({
  baseURL: CHATGPT_CODEX_BASE_URL,
  chatCompletion: {
    useResponse: true,
  },
  customClient: {
    createClient: ({ chatgptAccountId, ...options }) =>
      new OpenAI({
        ...options,
        defaultHeaders: {
          ...options.defaultHeaders,
          ...(chatgptAccountId && { 'ChatGPT-Account-Id': chatgptAccountId }),
          'User-Agent': USER_AGENT,
          'originator': 'lobehub',
          'session-id': crypto.randomUUID(),
          'version': CURRENT_VERSION,
        },
      }),
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_CHATGPT_CHAT_COMPLETION === '1',
    responses: () => process.env.DEBUG_CHATGPT_RESPONSES === '1',
  },
  provider: ModelProvider.ChatGPT,
  responses: {
    handlePayload: (payload) => {
      const handledPayload = openAIParams.responses?.handlePayload?.(payload) || payload;
      const { service_tier: _serviceTier, ...rest } = handledPayload;

      // The ChatGPT Codex backend manages output limits from the subscription
      // model catalog and rejects the public API's max_output_tokens field.
      return {
        ...rest,
        include: ['reasoning.encrypted_content'],
        max_tokens: undefined,
      };
    },
    prepareRequest: (payload) => {
      const { safety_identifier: _safetyIdentifier, ...subscriptionPayload } = payload;

      // Final capability gate for `reasoning.mode`: strip the field for models
      // the Codex backend rejects it on (see supportsReasoningMode). This runs
      // after `modelIdMapping`, so a mapping from a supporting logical model
      // (e.g. gpt-5.6-sol) to a rejecting upstream model (e.g. gpt-6.1-sol)
      // still strips, and the inverse mapping keeps the field. Effort and
      // summary stay untouched — only `mode` is a subscription-catalog-gated
      // field, and a stale sub-agent override must not kill the whole request.
      const reasoning = supportsReasoningMode(subscriptionPayload.model)
        ? subscriptionPayload.reasoning
        : (() => {
            const { mode: _mode, ...reasoningWithoutMode } =
              (subscriptionPayload.reasoning as { mode?: string } | undefined) ?? {};
            return Object.keys(reasoningWithoutMode).length > 0 ? reasoningWithoutMode : undefined;
          })();

      if (!isResponsesLiteModel(subscriptionPayload.model)) {
        return {
          payload:
            reasoning === undefined
              ? subscriptionPayload
              : { ...subscriptionPayload, reasoning },
        };
      }

      // Codex GPT-5.6 models use Responses Lite: tools move into the input
      // sequence, reasoning spans all turns, and the protocol header is required.
      const {
        input,
        instructions,
        parallel_tool_calls: _parallelToolCalls,
        reasoning: _rawReasoning,
        tool_choice: toolChoice,
        tools,
        ...rest
      } = subscriptionPayload;
      const additionalTools: ChatGPTAdditionalToolsInput = {
        role: 'developer',
        tools: tools || [],
        type: 'additional_tools',
      };
      const developerInstructions =
        instructions && typeof instructions === 'string'
          ? [
              {
                content: [{ text: instructions, type: 'input_text' as const }],
                role: 'developer' as const,
                type: 'message' as const,
              },
            ]
          : [];

      return {
        headers: { [CHATGPT_RESPONSES_LITE_HEADER]: 'true' },
        payload: {
          ...rest,
          input: [
            additionalTools as OpenAI.Responses.ResponseInputItem,
            ...developerInstructions,
            ...(Array.isArray(input) ? input : []),
          ],
          parallel_tool_calls: false,
          reasoning: { ...reasoning, context: 'all_turns' },
          tool_choice: toolChoice || 'auto',
        },
      };
    },
  },
});
