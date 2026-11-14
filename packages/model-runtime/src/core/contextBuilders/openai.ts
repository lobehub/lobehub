import { Buffer } from 'buffer.js';
import type OpenAI from 'openai';
import { toFile } from 'openai';

import { disableStreamModels, systemToUserModels } from '../../providers/openai/modelId';
import type { ChatStreamPayload, OpenAIChatMessage, UserMessageContentPart } from '../../types';
import { imageUrlToBase64 } from '../../utils/imageToBase64';
import { fetchReferenceImageBytes } from '../../utils/referenceImageCache';
import { type SignatureScope } from '../../utils/signatureScope';
import { parseDataUri } from '../../utils/uriParser';
import { videoUrlToBase64 } from '../../utils/videoToBase64';

export type ExtendedChatCompletionContentPart = {
  type: 'video_url';
  video_url: {
    url: string;
  };
};

export type ConvertMessageContentOptions = {
  forceImageBase64?: boolean;
  forceVideoBase64?: boolean;
  model?: string;
  provider?: string;
  reasoningSignatureScope?: SignatureScope;
  supportsAudioInput?: boolean;
  strictToolPairing?: boolean;
  thoughtSignatureScope?: SignatureScope;
};

export type OpenAICompatibleContentPart =
  ExtendedChatCompletionContentPart | OpenAI.ChatCompletionContentPart | UserMessageContentPart;

export type ConvertibleMessageContentPart =
  | ExtendedChatCompletionContentPart
  | OpenAI.ChatCompletionContentPart
  | Extract<UserMessageContentPart, { type: 'audio_url' }>;

const OPENAI_AUDIO_INPUT_MAX_BYTES = 20 * 1024 * 1024;

const detectOpenAIAudioFormat = (base64: string): 'mp3' | 'wav' | undefined => {
  const header = Buffer.from(base64.replaceAll(/\s/g, '').slice(0, 64), 'base64');

  if (
    header.length >= 12 &&
    header.toString('ascii', 0, 4) === 'RIFF' &&
    header.toString('ascii', 8, 12) === 'WAVE'
  ) {
    return 'wav';
  }

  if (header.length >= 3 && header.toString('ascii', 0, 3) === 'ID3') return 'mp3';

  const hasMpegFrameSync = header.length >= 2 && header[0] === 0xff && (header[1] & 0xe0) === 0xe0;
  const hasMpegAudioLayer = header.length >= 2 && ((header[1] >> 1) & 0x03) !== 0;
  if (hasMpegFrameSync && hasMpegAudioLayer) return 'mp3';

  return undefined;
};

const convertAudioContent = async (
  content: Extract<UserMessageContentPart, { type: 'audio_url' }>,
  options?: ConvertMessageContentOptions,
): Promise<OpenAI.ChatCompletionContentPartInputAudio> => {
  if (!options?.supportsAudioInput) {
    throw new TypeError('Audio input is not supported by this provider runtime');
  }

  const { base64, type } = parseDataUri(content.audio_url.url);

  if (type === 'base64') {
    const format = base64 ? detectOpenAIAudioFormat(base64) : undefined;
    if (!base64 || !format) {
      throw new TypeError('OpenAI audio input only supports base64 WAV or MP3 data');
    }

    return { input_audio: { data: base64, format }, type: 'input_audio' };
  }

  if (type === 'url') {
    // imageUrlToBase64 is a generic binary downloader with SSRF-safe server fetching and
    // magic-byte MIME detection. The OpenAI adapter narrows the result to WAV/MP3 below.
    const converted = await imageUrlToBase64(content.audio_url.url, {
      maxBytes: OPENAI_AUDIO_INPUT_MAX_BYTES,
    });
    const format = detectOpenAIAudioFormat(converted.base64);
    if (!format) {
      throw new TypeError('OpenAI audio input only supports WAV or MP3 files');
    }

    return { input_audio: { data: converted.base64, format }, type: 'input_audio' };
  }

  throw new TypeError(`Invalid audio URL: ${content.audio_url.url}`);
};

export const isInternalThinkingContentPart = (
  content: OpenAICompatibleContentPart,
): content is Extract<UserMessageContentPart, { type: 'thinking' }> => content.type === 'thinking';

const isEmptyTextContentPart = (content: OpenAICompatibleContentPart) =>
  content.type === 'text' && !(content as { text?: string }).text;

/**
 * Drops content parts an OpenAI-compatible upstream must not receive.
 *
 * Signed reasoning turns arrive as `[thinking, text]` even when the reply was
 * tool calls only, which leaves `{ type: 'text', text: '' }` once thinking is
 * removed. Moonshot (official API and aggregators such as Novita) rejects that
 * with 400 "text content is empty" and every retry of the topic fails, while
 * `content: null` is accepted. When nothing remains, use `null` for tool-call
 * turns and `''` otherwise.
 */
export const filterOutgoingContentParts = (msg: any, parts: OpenAICompatibleContentPart[]) => {
  const filtered = parts.filter(
    (c) =>
      !isInternalThinkingContentPart(c) && (msg.role !== 'assistant' || !isEmptyTextContentPart(c)),
  );

  if (filtered.length > 0 || msg.role !== 'assistant') return filtered;

  return msg.tool_calls?.length ? null : '';
};

export const convertMessageContent = async (
  content: ConvertibleMessageContentPart,
  options?: ConvertMessageContentOptions,
): Promise<OpenAI.ChatCompletionContentPart | ExtendedChatCompletionContentPart> => {
  if (content.type === 'audio_url') return convertAudioContent(content, options);

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
    // a http url; generation retries and batch siblings reuse the same download
    ({ buffer, mimeType } = await fetchReferenceImageBytes(imageUrl, async (url) => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch image from ${url}: ${response.statusText}`);
      }
      return {
        buffer: Buffer.from(await response.arrayBuffer()),
        mimeType: response.headers.get('content-type') || 'image/png',
      };
    }));
  }

  return toFile(buffer, `image.${mimeType.split('/')[1]}`, { type: mimeType });
};
