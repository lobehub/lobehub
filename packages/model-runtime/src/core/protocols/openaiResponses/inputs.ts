import type OpenAI from 'openai';

import type { OpenAIChatMessage, UserMessageContentPart } from '../../../types';
import { resolveScopedSignature } from '../../../utils/signatureScope';
import {
  convertMessageContent,
  type ConvertMessageContentOptions,
  isInternalThinkingContentPart,
  type OpenAICompatibleContentPart,
} from '../../contextBuilders/openai';

export const convertOpenAIResponseInputs = async (
  messages: OpenAIChatMessage[],
  options?: ConvertMessageContentOptions,
) => {
  const strictToolPairing = options?.strictToolPairing === true;
  // OpenAI Responses API rejects inputs that keep a function_call without its matching
  // function_call_output. Example from production:
  // "No tool output found for function call call_w5odMFjtXEYBBVyBUAQNMOh5."
  const validToolCallIds = new Set<string>();
  const pairedToolOutputIds = new Set<string>();
  const customToolCallIds = new Set<string>();

  for (const message of messages) {
    if (message.role === 'assistant' && message.tool_calls?.length) {
      message.tool_calls.forEach((tool) => {
        if (tool.id) validToolCallIds.add(tool.id);
        if (tool.id && tool.type === 'custom') customToolCallIds.add(tool.id);
      });
    }
  }

  for (const message of messages) {
    if (
      message.role === 'tool' &&
      message.tool_call_id &&
      validToolCallIds.has(message.tool_call_id)
    ) {
      pairedToolOutputIds.add(message.tool_call_id);
    }
  }

  const inputGroups = await Promise.all(
    messages.map(async (message) => {
      const items: OpenAI.Responses.ResponseInputItem[] = [];
      const reasoning = message.reasoning;
      if (message.responsesTools) {
        return [
          {
            type: 'additional_tools',
            role: 'developer',
            tools: message.responsesTools,
          } satisfies OpenAI.Responses.ResponseInputItem,
        ];
      }

      /**
       * Resolve persisted Responses reasoning items for stateless replay. Encrypted
       * items must all match the current signature scope — a single foreign-scope item
       * would make OpenAI reject the whole request, so fail closed to the legacy path.
       */
      const resolveResponseItems = (): OpenAI.Responses.ResponseReasoningItem[] | undefined => {
        const responseItems = reasoning?.responseItems;
        if (!responseItems?.length) return undefined;

        const resolved: OpenAI.Responses.ResponseReasoningItem[] = [];
        for (const item of responseItems) {
          if (item.encrypted_content) {
            const encryptedContent = resolveScopedSignature(
              item.encrypted_content,
              options?.reasoningSignatureScope,
              'reasoning',
            );
            if (!encryptedContent) return undefined;

            resolved.push({
              ...item,
              encrypted_content: encryptedContent,
            } as OpenAI.Responses.ResponseReasoningItem);
          } else {
            /**
             * Without encrypted content the server cannot look the item up by id in a
             * stateless request, so drop the id and replay the visible summary only.
             */
            const { id: _id, ...rest } = item;
            resolved.push(rest as unknown as OpenAI.Responses.ResponseReasoningItem);
          }
        }

        return resolved;
      };

      const replayableResponseItems = resolveResponseItems();

      if (replayableResponseItems) {
        // Replay complete reasoning items verbatim and in original stream order.
        items.push(...replayableResponseItems);
      } else {
        const encryptedContent = resolveScopedSignature(
          reasoning?.signature,
          options?.reasoningSignatureScope,
          'reasoning',
        );

        // Preserve encrypted reasoning state for stateless Responses API requests.
        if (reasoning?.content || encryptedContent) {
          items.push({
            encrypted_content: encryptedContent,
            summary: reasoning?.content ? [{ text: reasoning.content, type: 'summary_text' }] : [],
            type: 'reasoning',
          } as OpenAI.Responses.ResponseReasoningItem);
        }
      }

      // if message is assistant messages with tool calls , transform it to function type item
      if (message.role === 'assistant' && message.tool_calls && message.tool_calls?.length > 0) {
        const toolCalls = strictToolPairing
          ? message.tool_calls.filter((tool) => !!tool.id && pairedToolOutputIds.has(tool.id))
          : message.tool_calls;

        toolCalls.forEach((tool) => {
          const identity = {
            call_id: tool.id,
            name: tool.function.name,
            ...(tool.namespace ? { namespace: tool.namespace } : {}),
          };
          items.push(
            tool.type === 'custom'
              ? {
                  ...identity,
                  input: tool.function.arguments,
                  type: 'custom_tool_call',
                }
              : {
                  ...identity,
                  arguments: strictToolPairing ? tool.function.arguments : tool.function.name,
                  type: 'function_call',
                },
          );
        });

        return items;
      }

      if (message.role === 'tool') {
        if (
          strictToolPairing &&
          (!message.tool_call_id || !pairedToolOutputIds.has(message.tool_call_id))
        )
          return items;

        if (message.responsesOutput !== undefined) {
          items.push({
            call_id: message.tool_call_id!,
            output: message.responsesOutput,
            type: customToolCallIds.has(message.tool_call_id!)
              ? 'custom_tool_call_output'
              : 'function_call_output',
          });
          return items;
        }

        // `function_call_output.output` is text-only. When the tool result
        // carries images (e.g. builtin `readFile` on an image file), keep the
        // output textual and re-attach the images as a follow-up user message
        // item — Responses pairs outputs to calls by `call_id`, so a message
        // item between outputs is fine.
        let outputText = message.content as string;
        let imageParts: UserMessageContentPart[] = [];

        if (Array.isArray(message.content)) {
          const parts = message.content as any[];
          imageParts = parts.filter((c) => c?.type === 'image_url');
          outputText =
            parts
              .filter((c) => c?.type === 'text' && typeof c.text === 'string')
              .map((c) => c.text)
              .join('\n\n') || (imageParts.length > 0 ? '[Image output attached below]' : '');
        }

        items.push({
          call_id: message.tool_call_id,
          output: outputText,
          type: customToolCallIds.has(message.tool_call_id!)
            ? 'custom_tool_call_output'
            : 'function_call_output',
        } as OpenAI.Responses.ResponseInputItem);

        if (imageParts.length > 0) {
          const imageContent = (
            await Promise.all(
              imageParts.map(async (c) => {
                const image = await convertMessageContent(
                  c as OpenAI.ChatCompletionContentPart,
                  options,
                );
                const imageUrl = (image as OpenAI.ChatCompletionContentPartImage).image_url;
                if (!imageUrl?.url) return undefined;
                return {
                  image_url: imageUrl.url,
                  type: 'input_image' as const,
                  ...(imageUrl.detail && { detail: imageUrl.detail }),
                };
              }),
            )
          ).filter((c) => !!c);

          if (imageContent.length > 0) {
            items.push({
              content: [
                {
                  text: `Image output of tool call ${message.tool_call_id}:`,
                  type: 'input_text' as const,
                },
                ...imageContent,
              ],
              role: 'user',
              type: 'message',
            } as OpenAI.Responses.ResponseInputItem);
          }
        }

        return items;
      }

      if (message.role === 'system') {
        items.push({ ...message, role: 'developer' } as OpenAI.Responses.ResponseInputItem);
        return items;
      }

      // default item
      // also need handle image

      const processedContent =
        typeof message.content === 'string'
          ? message.content
          : await Promise.all(
              (message.content || []).map(async (c) => {
                if (isInternalThinkingContentPart(c as OpenAICompatibleContentPart)) {
                  return undefined;
                }

                if (c.type === 'text') {
                  // if assistant message, set type to output_text
                  // https://platform.openai.com/docs/guides/text
                  if (message.role === 'assistant') {
                    return { ...c, type: 'output_text' };
                  }
                  return { ...c, type: 'input_text' };
                }

                // Responses API only accepts output_text/refusal inside assistant history.
                // Multimodal parts are valid as model inputs, not as previous assistant outputs.
                if (message.role === 'assistant') {
                  return undefined;
                }

                if (c.type === 'video_url') {
                  const video = await convertMessageContent(c, options);
                  if (!('video_url' in video) || !video.video_url?.url) {
                    return undefined;
                  }
                  return {
                    video_url: video.video_url.url,
                    type: 'input_video',
                  };
                }
                if (c.type === 'audio_url') {
                  throw new TypeError('OpenAI raw audio input requires the Chat Completions API');
                }
                const image = await convertMessageContent(
                  c as OpenAI.ChatCompletionContentPart,
                  options,
                );
                const imageUrl = (image as OpenAI.ChatCompletionContentPartImage).image_url;
                if (!imageUrl?.url) {
                  return undefined;
                }
                // Forward the requested detail level so callers that need full resolution
                // (e.g. inspecting small annotations on screenshots) are not downgraded to auto.
                return {
                  image_url: imageUrl.url,
                  type: 'input_image',
                  ...(imageUrl.detail && { detail: imageUrl.detail }),
                };
              }),
            );

      const content =
        typeof processedContent === 'string'
          ? processedContent
          : processedContent.filter((m) => m !== undefined);

      if (message.role === 'assistant' && Array.isArray(content) && content.length === 0) {
        return items;
      }

      const {
        model: _model,
        provider: _provider,
        reasoning: _reasoning,
        ...responseMessage
      } = message;
      const item = {
        ...responseMessage,
        content,
      } as OpenAI.Responses.ResponseInputItem;

      items.push(item);
      return items;
    }),
  );

  return inputGroups.flat();
};
