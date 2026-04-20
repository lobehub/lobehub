import { imageUrlToBase64, videoUrlToBase64 } from '@lobechat/utils';
import { Buffer } from 'buffer/';
import type OpenAI from 'openai';
import { toFile } from 'openai';

import { disableStreamModels, systemToUserModels } from '../../const/models';
import type { ChatStreamPayload, OpenAIChatMessage, UserMessageContentPart } from '../../types';
import { parseDataUri } from '../../utils/uriParser';

export type ExtendedChatCompletionContentPart = {
  type: 'video_url';
  video_url: {
    url: string;
  };
};

type ConvertMessageContentOptions = {
  forceImageBase64?: boolean;
  forceVideoBase64?: boolean;
  strictToolPairing?: boolean;
};

type OpenAICompatibleContentPart =
  | ExtendedChatCompletionContentPart
  | OpenAI.ChatCompletionContentPart
  | UserMessageContentPart;

const isInternalThinkingContentPart = (
  content: OpenAICompatibleContentPart,
): content is Extract<UserMessageContentPart, { type: 'thinking' }> => content.type === 'thinking';

export const convertMessageContent = async (
  content: OpenAI.ChatCompletionContentPart | ExtendedChatCompletionContentPart,
  options?: ConvertMessageContentOptions,
): Promise<OpenAI.ChatCompletionContentPart | ExtendedChatCompletionContentPart> => {
  if (content.type === 'image_url') {
    const { type } = parseDataUri(content.image_url.url);

    const shouldUseBase64 =
      options?.forceImageBase64 || process.env.LLM_VISION_IMAGE_USE_BASE64 === '1';

    if (type === 'url' && shouldUseBase64) {
      const { base64, mimeType } = await imageUrlToBase64(content.image_url.url);

      return {
        ...content,
        image_url: { ...content.image_url, url: `data:${mimeType};base64,${base64}` },
      };
    }
  }

  if (content.type === 'video_url') {
    const { type } = parseDataUri(content.video_url.url);

    const shouldUseBase64 =
      options?.forceVideoBase64 || process.env.LLM_VISION_VIDEO_USE_BASE64 === '1';

    if (type === 'url' && shouldUseBase64) {
      try {
        const { base64, mimeType } = await videoUrlToBase64(content.video_url.url);

        return {
          ...content,
          video_url: { ...content.video_url, url: `data:${mimeType};base64,${base64}` },
        };
      } catch (error) {
        console.warn('Failed to convert video to base64:', error);
        return content;
      }
    }
  }

  return content;
};

export const convertOpenAIMessages = async (
  messages: OpenAI.ChatCompletionMessageParam[],
  options?: ConvertMessageContentOptions,
) => {
  return (await Promise.all(
    messages.map(async (message) => {
      const msg = message as any;

      // Explicitly map only valid ChatCompletionMessageParam fields
      // Exclude reasoning and reasoning_content fields as they should not be sent in requests
      const result: any = {
        content:
          typeof message.content === 'string'
            ? message.content
            : await Promise.all(
                (message.content || [])
                  .filter((c) => !isInternalThinkingContentPart(c as OpenAICompatibleContentPart))
                  .map((c) =>
                    convertMessageContent(c as OpenAI.ChatCompletionContentPart, options),
                  ),
              ),
        role: msg.role,
      };

      // Add optional fields if they exist
      if (msg.name !== undefined) result.name = msg.name;
      if (msg.tool_calls !== undefined) result.tool_calls = msg.tool_calls;
      if (msg.tool_call_id !== undefined) result.tool_call_id = msg.tool_call_id;
      if (msg.function_call !== undefined) result.function_call = msg.function_call;

      // it's compatible for DeepSeek & Moonshot
      if (msg.reasoning_content !== undefined) result.reasoning_content = msg.reasoning_content;
      // MiniMax uses reasoning_details for historical thinking, so forward it unchanged
      if (msg.reasoning_details !== undefined) result.reasoning_details = msg.reasoning_details;

      return result;
    }),
  )) as OpenAI.ChatCompletionMessageParam[];
};

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

  for (const message of messages) {
    if (message.role === 'assistant' && message.tool_calls?.length) {
      message.tool_calls.forEach((tool) => {
        if (tool.id) validToolCallIds.add(tool.id);
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

      // if message has reasoning, add it as a separate reasoning item
      if (message.reasoning?.content) {
        items.push({
          summary: [{ text: message.reasoning.content, type: 'summary_text' }],
          type: 'reasoning',
        } as OpenAI.Responses.ResponseReasoningItem);
      }

      // if message is assistant messages with tool calls , transform it to function type item
      if (message.role === 'assistant' && message.tool_calls && message.tool_calls?.length > 0) {
        const toolCalls = strictToolPairing
          ? message.tool_calls.filter((tool) => !!tool.id && pairedToolOutputIds.has(tool.id))
          : message.tool_calls;

        toolCalls.forEach((tool) => {
          items.push({
            arguments: strictToolPairing ? tool.function.arguments : tool.function.name,
            call_id: tool.id,
            name: tool.function.name,
            type: 'function_call',
          });
        });

        return items;
      }

      if (message.role === 'tool') {
        if (
          strictToolPairing &&
          (!message.tool_call_id || !pairedToolOutputIds.has(message.tool_call_id))
        )
          return items;

        items.push({
          call_id: message.tool_call_id,
          output: message.content,
          type: 'function_call_output',
        } as OpenAI.Responses.ResponseFunctionToolCallOutputItem);

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
                const image = await convertMessageContent(
                  c as OpenAI.ChatCompletionContentPart,
                  options,
                );
                if (!(image as OpenAI.ChatCompletionContentPartImage).image_url?.url) {
                  return undefined;
                }
                return {
                  image_url: (image as OpenAI.ChatCompletionContentPartImage).image_url?.url,
                  type: 'input_image',
                };
              }),
            );

      const item = {
        ...message,
        content:
          typeof processedContent === 'string'
            ? processedContent
            : processedContent.filter((m) => m !== undefined),
      } as OpenAI.Responses.ResponseInputItem;

      // remove reasoning field from the message item
      delete (item as any).reasoning;

      items.push(item);
      return items;
    }),
  );

  return inputGroups.flat();
};

export const pruneReasoningPayload = (payload: ChatStreamPayload) => {
  const shouldStream = !disableStreamModels.has(payload.model);
  const { stream_options, logprobs, top_logprobs, ...cleanedPayload } = payload as any;

  // When reasoning_effort is 'none', allow user-defined temperature/top_p
  const effort = payload.reasoning?.effort || payload.reasoning_effort;
  const isEffortNone = effort === 'none';

  return {
    ...cleanedPayload,
    frequency_penalty: 0,
    messages: payload.messages.map((message: OpenAIChatMessage) => ({
      ...message,
      role:
        message.role === 'system'
          ? systemToUserModels.has(payload.model)
            ? 'user'
            : 'developer'
          : message.role,
    })),
    presence_penalty: 0,
    stream: shouldStream,
    // Only include stream_options when stream is enabled
    ...(shouldStream && stream_options && { stream_options }),

    /**
     *  In openai docs: https://platform.openai.com/docs/guides/latest-model#gpt-5-2-parameter-compatibility
     *  Fields like `top_p`, `temperature`, `logprobs`, and `top_logprobs` are only supported by
     *  GPT-5 series (e.g. 5-mini 5-nano ) when reasoning effort is none
     */
    logprobs: isEffortNone ? logprobs : undefined,
    temperature: isEffortNone ? payload.temperature : undefined,
    top_logprobs: isEffortNone ? top_logprobs : undefined,
    top_p: isEffortNone ? payload.top_p : undefined,
  };
};

/**
 * Convert image URL (data URL or HTTP URL) to File object for OpenAI API
 */
export const convertImageUrlToFile = async (imageUrl: string) => {
  let buffer: Buffer;
  let mimeType: string;

  if (imageUrl.startsWith('data:')) {
    // a base64 image
    const [mimeTypePart, base64Data] = imageUrl.split(',');
    mimeType = mimeTypePart.split(':')[1].split(';')[0];
    buffer = Buffer.from(base64Data, 'base64');
  } else {
    // a http url
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image from ${imageUrl}: ${response.statusText}`);
    }
    buffer = Buffer.from(await response.arrayBuffer());
    mimeType = response.headers.get('content-type') || 'image/png';
  }

  return toFile(buffer, `image.${mimeType.split('/')[1]}`, { type: mimeType });
};
