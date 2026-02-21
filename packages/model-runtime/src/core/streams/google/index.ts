import type { GenerateContentResponse, Part } from '@google/genai';
import type { GroundingSearch } from '@lobechat/types';

import type { ChatStreamCallbacks } from '../../../types';
import { nanoid } from '../../../utils/uuid';
import { convertGoogleAIUsage } from '../../usageConverters/google-ai';
import type {
  ChatPayloadForTransformStream,
  StreamContext,
  StreamPartChunkData,
  StreamProtocolChunk,
  StreamToolCallChunkData,
} from '../protocol';
import {
  createCallbacksTransformer,
  createSSEProtocolTransformer,
  createTokenSpeedCalculator,
  generateToolCallId,
} from '../protocol';
import { GOOGLE_AI_BLOCK_REASON } from './const';

export const LOBE_ERROR_KEY = '__lobe_error';

const getBlockReasonMessage = (blockReason: string): string => {
  const blockReasonMessages = GOOGLE_AI_BLOCK_REASON;

  return (
    blockReasonMessages[blockReason as keyof typeof blockReasonMessages] ||
    blockReasonMessages.default.replace('{{blockReason}}', blockReason)
  );
};

const transformGoogleGenerativeAIStream = (
  chunk: GenerateContentResponse,
  context: StreamContext,
  payload?: ChatPayloadForTransformStream,
): StreamProtocolChunk | StreamProtocolChunk[] => {
  // Handle injected internal error marker to pass through detailed error info
  if ((chunk as any)?.[LOBE_ERROR_KEY]) {
    return {
      data: (chunk as any)[LOBE_ERROR_KEY],
      id: context?.id || 'error',
      type: 'error',
    };
  }
  // Handle promptFeedback with blockReason (e.g., PROHIBITED_CONTENT)
  if ('promptFeedback' in chunk && (chunk as any).promptFeedback?.blockReason) {
    const blockReason = (chunk as any).promptFeedback.blockReason;
    const humanFriendlyMessage = getBlockReasonMessage(blockReason);

    return {
      data: {
        body: {
          context: {
            promptFeedback: (chunk as any).promptFeedback,
          },
          message: humanFriendlyMessage,
          provider: 'google',
        },
        type: 'ProviderBizError',
      },
      id: context?.id || 'error',
      type: 'error',
    };
  }

  // maybe need another structure to add support for multiple choices
  const candidate = chunk.candidates?.[0];
  const { usageMetadata } = chunk;
  const usageChunks: StreamProtocolChunk[] = [];
  if (candidate?.finishReason && usageMetadata) {
    usageChunks.push({ data: candidate.finishReason, id: context?.id, type: 'stop' });

    const convertedUsage = convertGoogleAIUsage(usageMetadata, payload?.pricing);
    if (convertedUsage) {
      usageChunks.push({ data: convertedUsage, id: context?.id, type: 'usage' });
    }
  }

  // Parse function calls from candidate.content.parts
  const functionCalls =
    candidate?.content?.parts
      ?.filter((part: any) => part.functionCall)
      .map((part: Part) => ({
        ...part.functionCall,
        thoughtSignature: part.thoughtSignature,
      })) || [];

  if (functionCalls.length > 0) {
    return [
      {
        data: functionCalls.map(
          (value, index: number): StreamToolCallChunkData => ({
            function: {
              arguments: JSON.stringify(value.args),
              name: value.name,
            },
            id: generateToolCallId(index, value.name),
            index: index,
            thoughtSignature: value.thoughtSignature,
            type: 'function',
          }),
        ),
        id: context.id,
        type: 'tool_calls',
      },
      ...usageChunks,
    ];
  }

  // Parse text from candidate.content.parts
  // Filter out thought content (thought: true) only, keep thoughtSignature as it's just metadata
  const text =
    candidate?.content?.parts
      ?.filter((part: any) => part.text && !part.thought)
      .map((part: any) => part.text)
      .join('') || '';

  if (candidate) {
    // Check if this response contains reasoning or multimodal content
    const parts = candidate.content?.parts || [];
    const hasReasoningParts = parts.some((p: any) => p.thought === true);
    const hasImageParts = parts.some((p: any) => p.inlineData);
    const hasThoughtSignature = parts.some((p: any) => p.thoughtSignature);

    // Check model version to determine if new format should be used
    const modelVersion = (chunk as any).modelVersion || '';
    const isGemini25Plus = modelVersion.includes('gemini-2.5') || modelVersion.includes('gemini-3');
    const isGemini3Model =
      modelVersion.includes('gemini-3') || modelVersion.includes('image-preview');

    // Check if this is the old single-image scenario (single image part with finishReason)
    // This should use the legacy base64_image event format (only for gemini-2.0 and earlier)
    const isSingleImageWithFinish =
      parts.length === 1 &&
      hasImageParts &&
      !hasReasoningParts &&
      candidate.finishReason &&
      !isGemini25Plus;

    // Check if this has grounding metadata (should use legacy text + grounding events)
    const hasGroundingMetadata = !!candidate.groundingMetadata?.groundingChunks;

    // Use content_part/reasoning_part events when:
    // 1. There are reasoning parts in current chunk (thought: true)
    // 2. There are multiple parts with images (multimodal content)
    // 3. There are thoughtSignature in parts (reasoning metadata attached to content)
    // 4. This is Gemini 3 model with image generation (always use new format for consistency)
    // BUT NOT for:
    // - The legacy single-image scenario
    // - Grounding metadata scenario (uses legacy text + grounding events)
    const shouldUseMultimodalProcessing =
      (hasReasoningParts ||
        (hasImageParts && parts.length > 1) ||
        hasThoughtSignature ||
        isGemini3Model) &&
      !isSingleImageWithFinish &&
      !hasGroundingMetadata;

    // Process multimodal parts (text and images in reasoning or content)
    if (
      shouldUseMultimodalProcessing &&
      Array.isArray(candidate.content?.parts) &&
      candidate.content.parts.length > 0
    ) {
      const results: StreamProtocolChunk[] = [];

      for (const part of candidate.content.parts) {
        // 1. Reasoning text part
        if (part && part.text && part.thought === true) {
          results.push({
            data: {
              content: part.text,
              inReasoning: true,
              partType: 'text',
              thoughtSignature: part.thoughtSignature,
            } as StreamPartChunkData,
            id: context.id,
            type: 'reasoning_part',
          });
        }

        // 2. Reasoning image part
        else if (part && part.inlineData && part.thought === true) {
          results.push({
            data: {
              content: part.inlineData.data,
              inReasoning: true,
              mimeType: part.inlineData.mimeType,
              partType: 'image',
              thoughtSignature: part.thoughtSignature,
            } as StreamPartChunkData,
            id: context.id,
            type: 'reasoning_part',
          });
        }

        // 3. Content text part
        else if (part && part.text && !part.thought) {
          results.push({
            data: {
              content: part.text,
              partType: 'text',
              thoughtSignature: part.thoughtSignature,
            } as StreamPartChunkData,
            id: context.id,
            type: 'content_part',
          });
        }

        // 4. Content image part
        else if (part && part.inlineData && !part.thought) {
          results.push({
            data: {
              content: part.inlineData.data,
              mimeType: part.inlineData.mimeType,
              partType: 'image',
              thoughtSignature: part.thoughtSignature,
            } as StreamPartChunkData,
            id: context.id,
            type: 'content_part',
          });
        }
      }

      // If we found multimodal parts, return them with usage chunks
      if (results.length > 0) {
        if (candidate.finishReason && usageMetadata) {
          results.push(...usageChunks);
        }
        return results;
      }
    }

    // return the grounding
    const { groundingChunks, webSearchQueries } = candidate.groundingMetadata ?? {};
    if (groundingChunks) {
      return [
        { data: text, id: context.id, type: 'text' },
        {
          data: {
            citations: groundingChunks?.map((chunk) => ({
              // Google returns a uri processed by Google itself, so it cannot display the real favicon
              // Need to use title as a replacement
              favicon: chunk.web?.title,
              title: chunk.web?.title,
              url: chunk.web?.uri,
            })),
            searchQueries: webSearchQueries,
          } as GroundingSearch,
          id: context.id,
          type: 'grounding',
        },
        ...usageChunks,
      ];
    }

    // Check for image data before handling finishReason
    if (Array.isArray(candidate.content?.parts) && candidate.content.parts.length > 0) {
      // Filter out reasoning content and get first non-reasoning part
      const part = candidate.content.parts.find((p: any) => !p.thought);

      if (part && part.inlineData && part.inlineData.data && part.inlineData.mimeType) {
        const imageChunk = {
          data: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
          id: context.id,
          type: 'base64_image' as const,
        };

        // If also has finishReason, combine image with finish chunks
        if (candidate.finishReason) {
          const chunks: StreamProtocolChunk[] = [imageChunk];
          if (chunk.usageMetadata) {
            // usageChunks already includes the 'stop' chunk as its first entry when usage exists,
            // so append usageChunks to avoid sending a duplicate 'stop'.
            chunks.push(...usageChunks);
          } else {
            // No usage metadata, we need to send the stop chunk explicitly.
            chunks.push({ data: candidate.finishReason, id: context?.id, type: 'stop' });
          }
          return chunks;
        }

        return imageChunk;
      }
    }

    if (candidate.finishReason) {
      if (chunk.usageMetadata) {
        return [
          !!text ? { data: text, id: context?.id, type: 'text' } : undefined,
          ...usageChunks,
        ].filter(Boolean) as StreamProtocolChunk[];
      }
      // When there is finishReason but no text content, send an empty text chunk to stop the loading animation
      return [
        { data: '', id: context?.id, type: 'text' },
        { data: candidate.finishReason, id: context?.id, type: 'stop' },
      ];
    }

    if (!!text?.trim()) return { data: text, id: context?.id, type: 'text' };
  }

  return {
    data: text || '',
    id: context?.id,
    type: 'text',
  };
};

export interface GoogleAIStreamOptions {
  callbacks?: ChatStreamCallbacks;
  enableStreaming?: boolean; // Select TPS calculation method (pass false for non-streaming)
  inputStartAt?: number;
  payload?: ChatPayloadForTransformStream;
}

export const GoogleGenerativeAIStream = (
  rawStream: ReadableStream<GenerateContentResponse>,
  { callbacks, inputStartAt, enableStreaming = true, payload }: GoogleAIStreamOptions = {},
) => {
  const streamStack: StreamContext = { id: 'chat_' + nanoid() };

  const transformWithPayload: typeof transformGoogleGenerativeAIStream = (chunk, ctx) =>
    transformGoogleGenerativeAIStream(chunk, ctx, payload);

  return rawStream
    .pipeThrough(
      createTokenSpeedCalculator(transformWithPayload, {
        enableStreaming: enableStreaming,
        inputStartAt,
        streamStack,
      }),
    )
    .pipeThrough(
      createSSEProtocolTransformer((c) => c, streamStack, { requireTerminalEvent: true }),
    )
    .pipeThrough(createCallbacksTransformer(callbacks));
};
