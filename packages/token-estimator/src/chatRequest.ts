import { type AudioTokenEstimateSource, estimateAudioInputTokens } from './audio';
import { VISUAL_INPUT_TOKEN_ESTIMATE } from './media';
import { estimateSerializableTokens } from './text';

/**
 * One message of an OpenAI-shaped chat request. Typed structurally so the
 * model-runtime, context-engine and server message types all fit.
 */
export interface ChatRequestMessage {
  content?: unknown;
  name?: string;
  reasoning?: { content?: unknown } | null;
  role?: string;
  tool_call_id?: string;
  tool_calls?: unknown;
}

export interface EstimateChatRequestInputTokensOptions {
  /** Conservative per-audio fallback used when duration or the model rate is unavailable. */
  audioTokenEstimate?: number;
  /** Positive model-specific audio input token rate for duration-based estimates. */
  audioTokensPerSecond?: number;
  /** Token estimate for each image input; defaults to {@link VISUAL_INPUT_TOKEN_ESTIMATE}. */
  imageTokenEstimate?: number;
  /**
   * The request's top-level `tools` array. Providers receive tool definitions
   * with the request, so they count as input text.
   */
  tools?: readonly unknown[];
  /** Token estimate for each video input; defaults to {@link VISUAL_INPUT_TOKEN_ESTIMATE}. */
  videoTokenEstimate?: number;
}

export interface ChatRequestInputTokenEstimate {
  /** Audio parts in the request. */
  audioCount: number;
  audioDurationItemCount: number;
  audioFallbackItemCount: number;
  audioTokenEstimateSource: AudioTokenEstimateSource;
  audioTokens: number;
  /** Image parts in the request. */
  imageCount: number;
  imageTokens: number;
  textTokens: number;
  totalTokens: number;
  /** Video parts in the request. */
  videoCount: number;
  videoTokens: number;
}

interface ContentPart {
  audio_url?: { durationMs?: unknown };
  text?: string;
  type?: string;
}

/**
 * Estimate the input tokens of an OpenAI-shaped chat request before the
 * provider reports usage: text-like fields and tool definitions through
 * `tokenx`, media parts by item (never by their often base64 URL text).
 *
 * For pre-flight checks, UI hints and fallback usage only; final billing uses
 * provider usage.
 */
export function estimateChatRequestInputTokens(
  messages: readonly ChatRequestMessage[],
  options: EstimateChatRequestInputTokensOptions = {},
): ChatRequestInputTokenEstimate {
  const imageTokenEstimate = options.imageTokenEstimate ?? VISUAL_INPUT_TOKEN_ESTIMATE;
  const videoTokenEstimate = options.videoTokenEstimate ?? VISUAL_INPUT_TOKEN_ESTIMATE;
  const audioParts: Array<{ durationMs?: unknown }> = [];
  let textTokens = 0;
  let imageCount = 0;
  let videoCount = 0;

  for (const message of messages) {
    textTokens += estimateSerializableTokens(message.role);
    textTokens += estimateSerializableTokens(message.name);
    textTokens += estimateSerializableTokens(message.tool_call_id);
    textTokens += estimateSerializableTokens(message.tool_calls);
    textTokens += estimateSerializableTokens(message.reasoning?.content);

    if (!Array.isArray(message.content)) {
      textTokens += estimateSerializableTokens(message.content);
      continue;
    }

    for (const part of message.content as ContentPart[]) {
      switch (part?.type) {
        case 'text': {
          textTokens += estimateSerializableTokens(part.text);
          break;
        }
        case 'image_url': {
          imageCount += 1;
          break;
        }
        case 'video_url': {
          videoCount += 1;
          break;
        }
        case 'audio_url': {
          audioParts.push(part.audio_url ?? {});
          break;
        }
        default: {
          textTokens += estimateSerializableTokens(part);
        }
      }
    }
  }

  textTokens += estimateSerializableTokens(options.tools);

  const audio = estimateAudioInputTokens(audioParts, {
    fallbackTokensPerItem: options.audioTokenEstimate,
    tokensPerSecond: options.audioTokensPerSecond,
  });
  const imageTokens = imageCount * imageTokenEstimate;
  const videoTokens = videoCount * videoTokenEstimate;

  return {
    audioCount: audioParts.length,
    audioDurationItemCount: audio.durationItemCount,
    audioFallbackItemCount: audio.fallbackItemCount,
    audioTokenEstimateSource: audio.source,
    audioTokens: audio.tokens,
    imageCount,
    imageTokens,
    textTokens,
    totalTokens: textTokens + imageTokens + audio.tokens + videoTokens,
    videoCount,
    videoTokens,
  };
}
