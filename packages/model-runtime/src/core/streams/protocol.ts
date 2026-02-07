import { ChatCitationItem, ModelPerformance, ModelUsage } from '@lobechat/types';
import type { Pricing } from 'model-bank';

import { parseToolCalls } from '../../helpers';
import { ChatStreamCallbacks } from '../../types';
import { AgentRuntimeErrorType } from '../../types/error';
import { safeParseJSON } from '../../utils/safeParseJSON';
import { nanoid } from '../../utils/uuid';
import type { ComputeChatCostOptions } from '../usageConverters/utils/computeChatCost';

export type ChatPayloadForTransformStream = {
  model?: string;
  pricing?: Pricing;
  pricingOptions?: ComputeChatCostOptions;
  provider?: string;
};

/**
 * context in the stream to save temporarily data
 */
export interface StreamContext {
  id: string;
  /**
   * As pplx citations is in every chunk, but we only need to return it once
   * this flag is used to check if the pplx citation is returned,and then not return it again.
   * Same as Hunyuan and Wenxin
   */
  returnedCitation?: boolean;
  /**
   * Claude's citations are inline and interleaved with text output.
   * Each text segment may carry references to sources (e.g., web search results)
   * relevant to that specific portion of the generated content.
   * This array accumulates all citation items received during the streaming response.
   */
  returnedCitationArray?: ChatCitationItem[];
  /**
   * O series models need a condition to separate part
   */
  startReasoning?: boolean;
  thinking?: {
    id: string;
    name: string;
  };
  /**
   * Indicates whether the current state is within a "thinking" segment of the model output
   * (e.g., when processing lmstudio responses).
   *
   * When parsing output containing <think> and </think> tags:
   * - Set to `true` upon encountering a <think> tag (entering reasoning mode)
   * - Set to `false` upon encountering a </think> tag (exiting reasoning mode)
   *
   * While `thinkingInContent` is `true`, subsequent content should be stored in `reasoning_content`.
   * When `false`, content should be stored in the regular `content` field.
   */
  thinkingInContent?: boolean;
  tool?: {
    id: string;
    index: number;
    name: string;
  };
  toolIndex?: number;
  /**
   * Map of tool information by index for parallel tool calls
   * Used when multiple tools are called in parallel (e.g., GPT-5.2 parallel search)
   */
  tools?: Record<number, { id: string; index: number; name: string }>;
  usage?: ModelUsage;
}

export interface StreamProtocolChunk {
  data: any;
  id?: string;
  type: // pure text
    | 'text'
    // base64 format image
    | 'base64_image'
    // Tools use
    | 'tool_calls'
    // Model Thinking
    | 'reasoning'
    // use for reasoning signature, maybe only anthropic
    | 'reasoning_signature'
    // flagged reasoning signature
    | 'flagged_reasoning_signature'
    // multimodal content part in reasoning
    | 'reasoning_part'
    // multimodal content part in content
    | 'content_part'
    // Search or Grounding
    | 'grounding'
    // stop signal
    | 'stop'
    // Error
    | 'error'
    // token usage
    | 'usage'
    // performance monitor
    | 'speed'
    // unknown data result
    | 'data';
}

/**
 * Stream content part chunk data for multimodal support
 */
export interface StreamPartChunkData {
  content: string;
  // whether this part is in reasoning or regular content
  inReasoning: boolean;
  // image MIME type
  mimeType?: string;
  // text content or base64 image data
  partType: 'text' | 'image';
  // Optional signature for reasoning verification (Google Gemini feature)
  thoughtSignature?: string;
}

export interface StreamToolCallChunkData {
  function?: {
    arguments?: string;
    name?: string | null;
  };
  id?: string;
  index: number;
  thoughtSignature?: string;
  type: 'function' | string;
}

export interface StreamProtocolToolCallChunk {
  data: StreamToolCallChunkData[];
  id: string;
  type: 'tool_calls';
}

export const generateToolCallId = (index: number, functionName?: string) =>
  `${functionName || 'unknown_tool_call'}_${index}_${nanoid()}`;

const chatStreamable = async function* <T>(stream: AsyncIterable<T>) {
  for await (const response of stream) {
    yield response;
  }
};

const ERROR_CHUNK_PREFIX = '%FIRST_CHUNK_ERROR%: ';

export function readableFromAsyncIterable<T>(iterable: AsyncIterable<T>) {
  let it = iterable[Symbol.asyncIterator]();
  return new ReadableStream<T>({
    async cancel(reason) {
      await it.return?.(reason);
    },

    async pull(controller) {
      try {
        const { done, value } = await it.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (e) {
        const error = e as Error;

        controller.enqueue(
          (ERROR_CHUNK_PREFIX +
            JSON.stringify({ message: error.message, name: error.name, stack: error.stack })) as T,
        );
        controller.close();
      }
    },
  });
}

// make the response to the streamable format
export const convertIterableToStream = <T>(stream: AsyncIterable<T>) => {
  const iterable = chatStreamable(stream);

  // copy from https://github.com/vercel/ai/blob/d3aa5486529e3d1a38b30e3972b4f4c63ea4ae9a/packages/ai/streams/ai-stream.ts#L284
  // and add an error handle
  let it = iterable[Symbol.asyncIterator]();

  return new ReadableStream<T>({
    async cancel(reason) {
      await it.return?.(reason);
    },
    async pull(controller) {
      try {
        const { done, value } = await it.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (e) {
        const error = e as Error;

        controller.enqueue(
          (ERROR_CHUNK_PREFIX +
            JSON.stringify({ message: error.message, name: error.name, stack: error.stack })) as T,
        );
        controller.close();
      }
    },

    async start(controller) {
      try {
        const { done, value } = await it.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (e) {
        const error = e as Error;

        controller.enqueue(
          (ERROR_CHUNK_PREFIX +
            JSON.stringify({ message: error.message, name: error.name, stack: error.stack })) as T,
        );
        controller.close();
      }
    },
  });
};

/**
 * Create a transformer to convert the response into an SSE format
 */
export const createSSEProtocolTransformer = (
  transformer: (chunk: any, stack: StreamContext) => StreamProtocolChunk | StreamProtocolChunk[],
  streamStack?: StreamContext,
  options?: { requireTerminalEvent?: boolean },
) => {
  let hasTerminalEvent = false;
  const requireTerminalEvent = Boolean(options?.requireTerminalEvent);

  return new TransformStream({
    flush(controller) {
      // If the upstream closes without sending a terminal event, emit a final error event
      if (requireTerminalEvent && !hasTerminalEvent) {
        const id = streamStack?.id || 'stream_end';
        const data = {
          body: { name: 'Stream parsing error', reason: 'unexpected_end' },
          message: 'Stream ended unexpectedly',
          name: 'Stream parsing error',
          type: 'StreamChunkError',
        };
        controller.enqueue(`id: ${id}\n`);
        controller.enqueue(`event: error\n`);
        controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
      }
    },
    transform: (chunk, controller) => {
      const result = transformer(chunk, streamStack || { id: '' });

      const buffers = Array.isArray(result) ? result : [result];

      buffers.forEach(({ type, id, data }) => {
        controller.enqueue(`id: ${id}\n`);
        controller.enqueue(`event: ${type}\n`);
        controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);

        // mark terminal when receiving any of these events
        if (type === 'stop' || type === 'usage' || type === 'error') hasTerminalEvent = true;
      });
    },
  });
};

export function createCallbacksTransformer(cb: ChatStreamCallbacks | undefined) {
  const textEncoder = new TextEncoder();
  let aggregatedText = '';
  let aggregatedThinking: string | undefined = undefined;
  let usage: ModelUsage | undefined;
  let speed: ModelPerformance | undefined;
  let grounding: any;
  let toolsCalling: any;
  // Track base64 images for accumulation
  let base64Images: Array<{ data: string; id: string }> = [];

  let currentType = '' as unknown as StreamProtocolChunk['type'];
  const callbacks = cb || {};

  return new TransformStream<string, Uint8Array>({
    async flush(): Promise<void> {
      const data = {
        grounding,
        speed,
        text: aggregatedText,
        thinking: aggregatedThinking,
        toolsCalling,
        usage,
      };

      if (callbacks.onCompletion) {
        await callbacks.onCompletion(data);
      }

      if (callbacks.onFinal) {
        await callbacks.onFinal(data);
      }
    },

    async start(): Promise<void> {
      if (callbacks.onStart) await callbacks.onStart();
    },

    async transform(chunk: string, controller): Promise<void> {
      controller.enqueue(textEncoder.encode(chunk));

      // track the type of the chunk
      if (chunk.startsWith('event:')) {
        currentType = chunk.split('event:')[1].trim() as unknown as StreamProtocolChunk['type'];
      }
      // if the message is a data chunk, handle the callback
      else if (chunk.startsWith('data:')) {
        const content = chunk.split('data:')[1].trim();

        const data = safeParseJSON(content) as any;

        if (!data) return;

        switch (currentType) {
          case 'text': {
            aggregatedText += data;
            await callbacks.onText?.(data);
            break;
          }

          case 'reasoning': {
            if (!aggregatedThinking) {
              aggregatedThinking = '';
            }

            aggregatedThinking += data;
            await callbacks.onThinking?.(data);
            break;
          }

          case 'base64_image': {
            // data format: { image: { id, data }, images: [...] }
            const imageData = data as { image: { data: string; id: string }; images: any[] };
            base64Images.push(imageData.image);
            await callbacks.onBase64Image?.({
              image: imageData.image,
              images: base64Images,
            });
            break;
          }

          case 'content_part': {
            // data format: StreamPartChunkData
            const partData = data as StreamPartChunkData;
            await callbacks.onContentPart?.({
              content: partData.content,
              mimeType: partData.mimeType,
              partType: partData.partType,
              thoughtSignature: partData.thoughtSignature,
            });
            break;
          }

          case 'reasoning_part': {
            // data format: StreamPartChunkData
            const partData = data as StreamPartChunkData;
            await callbacks.onReasoningPart?.({
              content: partData.content,
              mimeType: partData.mimeType,
              partType: partData.partType,
              thoughtSignature: partData.thoughtSignature,
            });
            break;
          }

          case 'usage': {
            usage = data;
            await callbacks.onUsage?.(data);
            break;
          }

          case 'speed': {
            speed = data;
            break;
          }

          case 'grounding': {
            grounding = data;
            await callbacks.onGrounding?.(data);
            break;
          }

          case 'tool_calls': {
            if (!toolsCalling) toolsCalling = [];
            toolsCalling = parseToolCalls(toolsCalling, data);

            await callbacks.onToolsCalling?.({ chunk: data, toolsCalling });
          }
        }
      }
    },
  });
}

export const FIRST_CHUNK_ERROR_KEY = '_isFirstChunkError';

export const createFirstErrorHandleTransformer = (
  errorHandler?: (errorJson: any) => any,
  provider?: string,
) => {
  return new TransformStream({
    transform(chunk, controller) {
      if (chunk.toString().startsWith(ERROR_CHUNK_PREFIX)) {
        const errorData = JSON.parse(chunk.toString().replace(ERROR_CHUNK_PREFIX, ''));

        controller.enqueue({
          ...errorData,
          [FIRST_CHUNK_ERROR_KEY]: true,
          errorType: errorHandler?.(errorData) || AgentRuntimeErrorType.ProviderBizError,
          provider,
        });
      } else {
        controller.enqueue(chunk);
      }
    },
  });
};

/**
 * create a transformer to remove SSE format data
 */
export const createSSEDataExtractor = () =>
  new TransformStream({
    transform(chunk: Uint8Array, controller) {
      // Convert Uint8Array to string
      const text = new TextDecoder().decode(chunk, { stream: true });

      // Handle multi-line data case
      const lines = text.split('\n');

      for (const line of lines) {
        // Only process lines starting with "data: "
        if (line.startsWith('data: ')) {
          // Extract the actual data after "data: "
          const jsonText = line.slice(6);

          // Skip heartbeat messages
          if (jsonText === '[DONE]') continue;

          try {
            // Parse JSON data
            const data = JSON.parse(jsonText);
            // Pass parsed data to the next processor
            controller.enqueue(data);
          } catch {
            console.warn('Failed to parse SSE data:', jsonText);
          }
        }
      }
    },
  });

export const TOKEN_SPEED_CHUNK_ID = 'output_speed';

/**
 * Create a middleware to calculate the token generate speed
 * @requires createSSEProtocolTransformer
 */
export const createTokenSpeedCalculator = (
  transformer: (chunk: any, stack: StreamContext) => StreamProtocolChunk | StreamProtocolChunk[],
  {
    inputStartAt,
    streamStack,
    enableStreaming = true, // Select TPS calculation method (pass false for non-streaming)
  }: { enableStreaming?: boolean; inputStartAt?: number; streamStack?: StreamContext } = {},
) => {
  let outputStartAt: number | undefined;

  const process = (chunk: StreamProtocolChunk) => {
    let result = [chunk];
    // Set outputStartAt when receiving the first content chunk (for TTFT calculation)
    // - text/reasoning: standard text output events
    // - content_part/reasoning_part: multimodal output events used by Gemini 3+ models
    //   which emit structured parts instead of plain text events
    // - tool_calls: function calling output events
    if (
      !outputStartAt &&
      (chunk.type === 'text' ||
        chunk.type === 'reasoning' ||
        chunk.type === 'content_part' ||
        chunk.type === 'reasoning_part' ||
        chunk.type === 'tool_calls')
    ) {
      outputStartAt = Date.now();
    }

    // if the chunk is the stop chunk, set as output finish
    if (inputStartAt && outputStartAt && chunk.type === 'usage') {
      // TPS should always include all generated tokens (including reasoning tokens)
      // because it measures generation speed, not just visible content
      const usage = chunk.data as ModelUsage;
      const outputTokens = usage?.totalOutputTokens ?? 0;
      const now = Date.now();
      const elapsed = now - (enableStreaming ? outputStartAt : inputStartAt);
      const duration = now - outputStartAt;
      const latency = now - inputStartAt;
      const ttft = outputStartAt - inputStartAt;
      const tps = elapsed === 0 ? undefined : (outputTokens / elapsed) * 1000;

      result.push({
        data: {
          duration,
          latency,
          tps,
          ttft,
        } as ModelPerformance,
        id: TOKEN_SPEED_CHUNK_ID,
        type: 'speed',
      });
    }
    return result;
  };

  return new TransformStream({
    transform(chunk, controller) {
      let result = transformer(chunk, streamStack || { id: '' });
      if (!Array.isArray(result)) result = [result];
      result.forEach((r) => {
        const processed = process(r);
        if (processed) processed.forEach((p) => controller.enqueue(p));
      });
    },
  });
};
