import type { GenerateContentResponse } from '@google/genai';
import type { GroundingSearch } from '@lobechat/types';

import { nanoid } from '../../utils/uuid';
import { convertGoogleAIUsage } from '../usageConverters/google-ai';
import type { GoogleAIStreamOptions } from './google';
import type {
  ChatPayloadForTransformStream,
  StreamContext,
  StreamPartChunkData,
  StreamProtocolChunk,
} from './protocol';
import {
  createCallbacksTransformer,
  createSSEProtocolTransformer,
  createTokenSpeedCalculator,
  generateToolCallId,
} from './protocol';

const transformVertexAIStream = (
  chunk: GenerateContentResponse,
  context: StreamContext,
  payload?: ChatPayloadForTransformStream,
): StreamProtocolChunk | StreamProtocolChunk[] => {
  // maybe need another structure to add support for multiple choices
  const candidate = chunk.candidates?.[0];
  const usageMetadata = chunk.usageMetadata;
  const usageChunks: StreamProtocolChunk[] = [];
  if (candidate?.finishReason && usageMetadata) {
    usageChunks.push(
      { data: candidate.finishReason, id: context?.id, type: 'stop' },
      {
        data: convertGoogleAIUsage(usageMetadata, payload?.pricing),
        id: context?.id,
        type: 'usage',
      },
    );
  }

  if (!candidate) {
    return { data: '', id: context?.id, type: 'text' };
  }

  const parts = candidate.content?.parts || [];
  const hasReasoningParts = parts.some((p: any) => p.thought === true);
  const hasImageParts = parts.some((p: any) => p.inlineData);

  // Process multimodal parts (reasoning, text + image mixed content)
  if (parts.length > 0 && (hasReasoningParts || hasImageParts)) {
    const results: StreamProtocolChunk[] = [];

    for (const part of parts) {
      if (part && part.text && part.thought === true) {
        results.push({
          data: { content: part.text, inReasoning: true, partType: 'text' } as StreamPartChunkData,
          id: context.id,
          type: 'reasoning_part',
        });
      } else if (part && part.inlineData && part.thought === true) {
        results.push({
          data: {
            content: part.inlineData.data,
            inReasoning: true,
            mimeType: part.inlineData.mimeType,
            partType: 'image',
          } as StreamPartChunkData,
          id: context.id,
          type: 'reasoning_part',
        });
      } else if (part && part.text && !part.thought) {
        results.push({
          data: { content: part.text, partType: 'text' } as StreamPartChunkData,
          id: context.id,
          type: 'content_part',
        });
      } else if (part && part.inlineData && !part.thought) {
        results.push({
          data: {
            content: part.inlineData.data,
            mimeType: part.inlineData.mimeType,
            partType: 'image',
          } as StreamPartChunkData,
          id: context.id,
          type: 'content_part',
        });
      }
    }

    if (results.length > 0) {
      if (candidate.finishReason && usageMetadata) {
        results.push(...usageChunks);
      }
      return results;
    }
  }

  if (candidate.content) {
    const part = candidate.content.parts?.[0];

    if (part?.functionCall) {
      const functionCall = part.functionCall;

      return [
        {
          data: [
            {
              function: {
                arguments: JSON.stringify(functionCall.args),
                name: functionCall.name,
              },
              id: generateToolCallId(0, functionCall.name),
              index: 0,
              type: 'function',
            },
          ],
          id: context?.id,
          type: 'tool_calls',
        },
        ...usageChunks,
      ];
    }

    // return the grounding
    const { groundingChunks, webSearchQueries } = candidate.groundingMetadata ?? {};
    if (groundingChunks) {
      return [
        !!part?.text ? { data: part.text, id: context?.id, type: 'text' } : undefined,
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
      ].filter(Boolean) as StreamProtocolChunk[];
    }

    if (candidate.finishReason) {
      if (usageMetadata) {
        return [
          !!part?.text ? { data: part.text, id: context?.id, type: 'text' } : undefined,
          ...usageChunks,
        ].filter(Boolean) as StreamProtocolChunk[];
      }
      return { data: candidate.finishReason, id: context?.id, type: 'stop' };
    }

    return {
      data: part?.text,
      id: context?.id,
      type: 'text',
    };
  }

  return {
    data: '',
    id: context?.id,
    type: 'stop',
  };
};

export const VertexAIStream = (
  rawStream: ReadableStream<GenerateContentResponse>,
  { callbacks, inputStartAt, enableStreaming = true, payload }: GoogleAIStreamOptions = {},
) => {
  const streamStack: StreamContext = { id: 'chat_' + nanoid() };

  const transformWithPayload: typeof transformVertexAIStream = (chunk, ctx) =>
    transformVertexAIStream(chunk, ctx, payload);

  return rawStream
    .pipeThrough(
      createTokenSpeedCalculator(transformWithPayload, {
        enableStreaming,
        inputStartAt,
        streamStack,
      }),
    )
    .pipeThrough(createSSEProtocolTransformer((c) => c, streamStack))
    .pipeThrough(createCallbacksTransformer(callbacks));
};
