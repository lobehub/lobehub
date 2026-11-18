import type OpenAI from 'openai';

import type { MessageToolCall } from '../../../types';
import { isDeepSeekThinkingEligibleModel } from '../../../utils/modelParse';
import { resolveScopedSignature } from '../../../utils/signatureScope';
import {
  type ConvertibleMessageContentPart,
  convertMessageContent,
  type ConvertMessageContentOptions,
  filterOutgoingContentParts,
  type OpenAICompatibleContentPart,
} from '../../contextBuilders/openai';

/**
 * Model families whose thinking mode requires the historical `reasoning_content`
 * to be echoed back when the assistant turn also carries `tool_calls`. Upstream
 * rejects the request outright otherwise:
 *
 * > If thinking mode and tool_calls, `reasoning_content` must be passed back to the API.
 *
 * Matched on the model id rather than the provider because these models are
 * mostly reached through OpenAI-compatible aggregators and user-configured
 * proxies, where the provider key says nothing about the underlying family.
 */
const REASONING_PASSBACK_MODEL_KEYWORDS = ['deepseek', 'glm', 'kimi'] as const;

const requiresReasoningPassback = (model: string | undefined) =>
  typeof model === 'string' &&
  REASONING_PASSBACK_MODEL_KEYWORDS.some((keyword) => model.toLowerCase().includes(keyword));

/**
 * OpenAI tool messages only accept text content — the Chat Completions API
 * rejects `image_url` parts inside a `role: 'tool'` message. When a tool
 * result carries images (e.g. builtin `readFile` on an image file), flatten
 * the tool message to text and re-attach the images as a `user` message
 * placed AFTER the contiguous tool-result batch: every tool message must
 * directly follow the assistant message holding its `tool_calls`, so nothing
 * may be interleaved inside the batch.
 */
const extractToolMessageImages = (
  converted: OpenAI.ChatCompletionMessageParam[],
): OpenAI.ChatCompletionMessageParam[] => {
  const output: OpenAI.ChatCompletionMessageParam[] = [];
  let pendingToolImages: { parts: OpenAI.ChatCompletionContentPart[]; toolCallId?: string }[] = [];

  const flushToolImages = () => {
    if (pendingToolImages.length === 0) return;

    const content = pendingToolImages.flatMap((pending) => [
      { text: `Image output of tool call ${pending.toolCallId}:`, type: 'text' as const },
      ...pending.parts,
    ]);
    output.push({ content, role: 'user' });
    pendingToolImages = [];
  };

  for (const message of converted) {
    if (message.role !== 'tool') flushToolImages();

    if (message.role === 'tool' && Array.isArray(message.content)) {
      const parts = message.content as any[];
      const imageParts = parts.filter((c) => c?.type === 'image_url' || c?.type === 'video_url');
      const text = parts
        .filter((c) => c?.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text)
        .join('\n\n');

      if (imageParts.length > 0) {
        pendingToolImages.push({ parts: imageParts, toolCallId: message.tool_call_id });
      }

      output.push({
        ...message,
        content: text || (imageParts.length > 0 ? '[Image output attached below]' : ''),
      });
      continue;
    }

    output.push(message);
  }

  flushToolImages();

  return output;
};

export const convertOpenAIMessages = async (
  messages: OpenAI.ChatCompletionMessageParam[],
  options?: ConvertMessageContentOptions,
) => {
  const converted = (await Promise.all(
    messages.map(async (message) => {
      const msg = message as any;

      // Explicitly map only valid ChatCompletionMessageParam fields
      // Exclude reasoning and reasoning_content fields as they should not be sent in requests
      const parts =
        typeof message.content === 'string'
          ? message.content
          : filterOutgoingContentParts(
              msg,
              (message.content || []) as OpenAICompatibleContentPart[],
            );

      const result: any = {
        content: Array.isArray(parts)
          ? await Promise.all(
              parts.map((c) => convertMessageContent(c as ConvertibleMessageContentPart, options)),
            )
          : parts,
        role: msg.role,
      };

      // Add optional fields if they exist
      if (msg.name !== undefined) result.name = msg.name;
      if (msg.tool_calls !== undefined) {
        result.tool_calls = msg.tool_calls.map((toolCall: MessageToolCall) => {
          if (!toolCall.thoughtSignature) return toolCall;

          const { thoughtSignature, ...rest } = toolCall;
          const resolvedSignature = resolveScopedSignature(
            thoughtSignature,
            options?.thoughtSignatureScope,
            'thought_signature',
          );

          return resolvedSignature ? { ...rest, thoughtSignature: resolvedSignature } : rest;
        });
      }
      if (msg.tool_call_id !== undefined) result.tool_call_id = msg.tool_call_id;
      if (msg.function_call !== undefined) result.function_call = msg.function_call;

      // it's compatible for DeepSeek & Moonshot
      if (msg.reasoning_content !== undefined) result.reasoning_content = msg.reasoning_content;
      // MiniMax uses reasoning_details for historical thinking, so forward it unchanged
      if (msg.reasoning_details !== undefined) result.reasoning_details = msg.reasoning_details;

      // For passback-requiring families routed via any OpenAI-compatible runtime
      // (including custom user providers that bypass a dedicated handlePayload),
      // derive reasoning_content from the structured reasoning field on assistant
      // messages.
      if (msg.role === 'assistant' && requiresReasoningPassback(options?.model)) {
        if (result.reasoning_content === undefined && typeof msg.reasoning?.content === 'string') {
          result.reasoning_content = msg.reasoning.content;
        }
        // The empty placeholder stays DeepSeek-scoped. Echoing reasoning we
        // actually have is what upstream asks for; fabricating an empty thinking
        // block for a family we have not validated is a different, riskier change.
        if (
          result.reasoning_content === undefined &&
          isDeepSeekThinkingEligibleModel(options?.model)
        ) {
          result.reasoning_content = '';
        }
      }

      return result;
    }),
  )) as OpenAI.ChatCompletionMessageParam[];

  return extractToolMessageImages(converted);
};
