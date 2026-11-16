import type { ChatCitationItem, ModelPerformance, ModelUsage } from '@lobechat/types';
import type { Pricing } from 'model-bank';

import type { ChatStreamCallbacks, UsageMissingDiagnostics } from '../../types';
import { AgentRuntimeErrorType } from '../../types/error';
import { safeParseJSON } from '../../utils/safeParseJSON';
import type { SignatureScope } from '../../utils/signatureScope';
import { nanoid } from '../../utils/uuid';
import type { ComputeChatCostOptions } from '../usageConverters/utils/computeChatCost';
import type { ModelStreamEvent } from './events';
import { createStreamCallbackDispatcher } from './events';

export type ChatPayloadForTransformStream = {
  apiMode?: UsageMissingDiagnostics['apiMode'];
  includeUsageRequested?: boolean;
  model?: string;
  pricing?: Pricing;
  pricingOptions?: ComputeChatCostOptions;
  provider?: string;
  reasoningSignatureScope?: SignatureScope;
  thoughtSignatureScope?: SignatureScope;
};

/**
 * context in the stream to save temporarily data
 */
export interface StreamContext {
  chunkIndex?: number;
  id: string;
  /** Options used to price `usage.cost`, forwarded so hooks can reprice the same usage. */
  pricingOptions?: ComputeChatCostOptions;
  /** Latest USD charge the upstream provider reported in a chunk. Server-side only. */
  providerReportedCost?: number;
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
  usageMissingDiagnostics?: UsageMissingDiagnostics;
}

export interface StreamProtocolChunk {
  data: any;
  id?: string;
  type:
    // pure text
    | 'text'
    // base64 format image
    | 'base64_image'
    // Tools use
    | 'tool_calls'
    // Model Thinking
    | 'reasoning'
    // use for reasoning signature, maybe only anthropic
    | 'reasoning_signature'
    // complete OpenAI Responses reasoning item persisted for stateless replay
    | 'reasoning_response_item'
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

export const ABORT_CHUNK = '%ABORT_CHUNK%';

const isAbortError = (error: unknown): boolean => {
  // SDK iterators may throw non-Error values (strings, plain objects without
  // a `message`) — guard before touching `.name`/`.message` so the abort
  // check itself can't blow up inside the stream error handler.
  if (!error || typeof error !== 'object') return false;

  const { name, message } = error as { message?: unknown; name?: unknown };

  return (
    name === 'AbortError' ||
    (typeof message === 'string' && (message.includes('aborted') || message.includes('cancelled')))
  );
};

/**
 * Optional diagnostic context attached to errors that surface from the
 * provider SDK iterator. Lets the FIRST_CHUNK_ERROR payload carry
 * provider/model identifiers so log triage can correlate identical
 * upstream failures across operations.
 */
export type StreamErrorContext = {
  model?: string;
  provider?: string;
};

/**
 * Build the FIRST_CHUNK_ERROR payload string for a thrown error.
 *
 * Beyond `message`/`name`/`stack`, this surfaces:
 * - `provider`/`model` from the caller, so error-log consumers know which
 *   upstream blew up without grepping for the operation
 * - `causeMessage`/`causeName` when `error.cause` is set — many wrapped
 *   errors (e.g. APIError around a SyntaxError) bury the actionable detail
 *   in `cause` and the bare triplet drops it
 * - `parsePosition` extracted from V8 JSON SyntaxError messages
 *   (e.g. `"Bad escaped character in JSON at position 160050"`) so we can
 *   group by failure offset and confirm the same chunk class is recurring.
 *   Walks both the outer error and any Error cause — SDKs commonly wrap
 *   the SyntaxError in an APIError, and the wrapped case is exactly the
 *   one this enrichment is meant to diagnose.
 */
const buildStreamErrorPayload = (error: Error, context?: StreamErrorContext): string => {
  const payload: Record<string, unknown> = {
    message: error.message,
    name: error.name,
    stack: error.stack,
  };

  if (context?.provider) payload.provider = context.provider;
  if (context?.model) payload.model = context.model;

  const cause = (error as { cause?: unknown }).cause;
  const causeAsError = cause instanceof Error ? cause : undefined;

  if (causeAsError) {
    payload.causeName = causeAsError.name;
    payload.causeMessage = causeAsError.message;
  } else if (cause !== undefined && cause !== null) {
    payload.cause = typeof cause === 'object' ? toJsonSafe(cause) : String(cause);
  }

  const parsePosition = extractParsePosition(error) ?? extractParsePosition(causeAsError);
  if (parsePosition !== undefined) payload.parsePosition = parsePosition;

  return ERROR_CHUNK_PREFIX + safeJsonStringify(payload);
};

/**
 * Extract a JSON parse offset from V8's `SyntaxError` message format
 * (`"... in JSON at position N (line ... column ...)"`). Accepts either a
 * `SyntaxError` directly or any `Error` whose message still carries the
 * `"JSON at position"` signature — wrapped errors routinely lose the
 * `SyntaxError` name but preserve the offset in the message string.
 */
const extractParsePosition = (error: Error | undefined): number | undefined => {
  if (!error) return undefined;
  const isJsonParseError = error.name === 'SyntaxError' || /JSON at position/i.test(error.message);
  if (!isJsonParseError) return undefined;
  const match = /position\s+(\d+)/i.exec(error.message);
  return match ? Number(match[1]) : undefined;
};

/**
 * `JSON.stringify` with a replacer that handles `BigInt` and circular refs
 * so the outer stringify in `buildStreamErrorPayload` never throws.
 *
 * If this throws, the FIRST_CHUNK_ERROR chunk never gets emitted and a
 * diagnostic path turns into a hard stream failure — `safeJsonStringify`
 * is the difference between "consumer sees a typed error" and "consumer
 * sees the stream just stop".
 */
const safeJsonStringify = (value: unknown): string => {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_key, val) => {
      if (typeof val === 'bigint') return val.toString();
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val as object)) return '[Circular]';
        seen.add(val as object);
      }
      return val;
    });
  } catch {
    return JSON.stringify({
      message: 'Failed to serialize error payload',
      name: 'StreamErrorSerializationFailure',
    });
  }
};

/**
 * Reduce an arbitrary cause object to a JSON-safe shape. `structuredClone`
 * succeeds on values that `JSON.stringify` later chokes on (cycles, BigInt,
 * functions in nested values), so the clone alone isn't enough — we run
 * the result through `safeJsonStringify` and parse it back so consumers
 * always receive plain JSON.
 */
const toJsonSafe = (cause: object): unknown => {
  try {
    return JSON.parse(safeJsonStringify(cause));
  } catch {
    return String(cause);
  }
};

export function readableFromAsyncIterable<T>(
  iterable: AsyncIterable<T>,
  context?: StreamErrorContext,
) {
  const it = iterable[Symbol.asyncIterator]();
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

        if (isAbortError(error)) {
          controller.enqueue(ABORT_CHUNK as T);
          controller.close();
          return;
        }

        controller.enqueue(buildStreamErrorPayload(error, context) as T);
        controller.close();
      }
    },
  });
}

// make the response to the streamable format
export const convertIterableToStream = <T>(
  stream: AsyncIterable<T>,
  context?: StreamErrorContext,
) => {
  const iterable = chatStreamable(stream);

  // copy from https://github.com/vercel/ai/blob/d3aa5486529e3d1a38b30e3972b4f4c63ea4ae9a/packages/ai/streams/ai-stream.ts#L284
  // and add an error handle
  const it: AsyncIterator<T> = iterable[Symbol.asyncIterator]();

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

        if (isAbortError(error)) {
          controller.enqueue(ABORT_CHUNK as T);
          controller.close();
          return;
        }

        controller.enqueue(buildStreamErrorPayload(error, context) as T);
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

        if (isAbortError(error)) {
          controller.enqueue(ABORT_CHUNK as T);
          controller.close();
          return;
        }

        controller.enqueue(buildStreamErrorPayload(error, context) as T);
        controller.close();
      }
    },
  });
};

/**
 * Fire callbacks for a stream that is already SSE text. Pipelines built from model events
 * should use `createEventCallbacksTransformer` instead.
 */
export function createCallbacksTransformer(
  cb: ChatStreamCallbacks | undefined,
  options?: { streamStack?: StreamContext },
) {
  const textEncoder = new TextEncoder();
  const dispatcher = createStreamCallbackDispatcher(cb, options);
  let currentType = '' as unknown as StreamProtocolChunk['type'];

  return new TransformStream<string, Uint8Array>({
    flush: () => dispatcher.finish(),

    async start(): Promise<void> {
      await dispatcher.start();
    },

    async transform(chunk: string, controller): Promise<void> {
      controller.enqueue(textEncoder.encode(chunk));

      if (chunk.startsWith('event:')) {
        currentType = chunk.split('event:')[1].trim() as unknown as StreamProtocolChunk['type'];
      } else if (chunk.startsWith('data:')) {
        // Strip only the leading field marker: any payload can contain `data:` itself
        // (model text, tool arguments, data URIs).
        const data = safeParseJSON(chunk.slice('data:'.length).trim());

        await dispatcher.dispatch({ data, type: currentType } as ModelStreamEvent);
      }
    },
  });
}

export const FIRST_CHUNK_ERROR_KEY = '_isFirstChunkError';

const SOCKET_DISCONNECT_PATTERN = /ECONNRESET|EPIPE|socket hang up|other side closed/i;

/**
 * The upstream connection dropped while the SDK iterator was reading the body: undici throws
 * `TypeError: terminated` with the socket error as `cause` (e.g. `read ECONNRESET`). Nothing
 * failed to parse, so it is a provider stream interruption, not a `ProviderBizError` that the
 * router later rewraps as a harness `StreamChunkError`.
 */
const isUpstreamDisconnect = (errorData: { causeMessage?: unknown; message?: unknown }) =>
  (typeof errorData.message === 'string' &&
    (errorData.message === 'terminated' || SOCKET_DISCONNECT_PATTERN.test(errorData.message))) ||
  (typeof errorData.causeMessage === 'string' &&
    SOCKET_DISCONNECT_PATTERN.test(errorData.causeMessage));

export const createFirstErrorHandleTransformer = (
  errorHandler?: (errorJson: any) => any,
  provider?: string,
) => {
  return new TransformStream({
    transform(chunk, controller) {
      if (chunk === ABORT_CHUNK) {
        controller.enqueue(chunk);
        return;
      }

      if (chunk.toString().startsWith(ERROR_CHUNK_PREFIX)) {
        const errorData = JSON.parse(chunk.toString().replace(ERROR_CHUNK_PREFIX, ''));

        controller.enqueue({
          ...errorData,
          [FIRST_CHUNK_ERROR_KEY]: true,
          errorType:
            errorHandler?.(errorData) ||
            (isUpstreamDisconnect(errorData)
              ? AgentRuntimeErrorType.ProviderStreamInterrupted
              : AgentRuntimeErrorType.ProviderBizError),
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

const hasEffectiveOutput = (chunk: StreamProtocolChunk): boolean => {
  switch (chunk.type) {
    case 'base64_image':
    case 'reasoning':
    case 'text': {
      return Boolean(chunk.data);
    }
    case 'content_part':
    case 'reasoning_part': {
      return Boolean((chunk.data as StreamPartChunkData | undefined)?.content);
    }
    case 'tool_calls': {
      return (
        (chunk.data as StreamToolCallChunkData[] | undefined)?.some(
          (tool) => tool.function?.name || tool.function?.arguments,
        ) ?? false
      );
    }
    default: {
      return false;
    }
  }
};

/**
 * Create a middleware to calculate the token generate speed
 * @requires createSSEEncoder
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
  let outputEndAt: number | undefined;

  const process = (chunk: StreamProtocolChunk) => {
    const result = [chunk];
    if (hasEffectiveOutput(chunk)) {
      const now = Date.now();
      outputStartAt ??= now;
      outputEndAt = now;
    }

    if (inputStartAt !== undefined && outputStartAt !== undefined && chunk.type === 'usage') {
      // TPS should always include all generated tokens (including reasoning tokens)
      // because it measures generation speed, not just visible content
      const usage = chunk.data as ModelUsage;
      const outputTokens = usage?.totalOutputTokens ?? 0;
      const now = Date.now();
      const duration = (outputEndAt ?? outputStartAt) - outputStartAt;
      const tps =
        enableStreaming && duration > 0 && outputTokens > 1
          ? (outputTokens / duration) * 1000
          : undefined;

      result.push({
        data: {
          duration: enableStreaming ? duration : undefined,
          latency: now - inputStartAt,
          tps,
          ttft: enableStreaming ? outputStartAt - inputStartAt : undefined,
        } as ModelPerformance,
        id: TOKEN_SPEED_CHUNK_ID,
        type: 'speed',
      });
    }
    return result;
  };

  return new TransformStream({
    transform(chunk, controller) {
      if (chunk === ABORT_CHUNK) {
        controller.enqueue({
          data: 'abort',
          id: streamStack?.id || '',
          type: 'stop',
        } as StreamProtocolChunk);
        return;
      }

      let result = transformer(chunk, streamStack || { id: '' });
      if (!Array.isArray(result)) result = [result];
      result.forEach((r) => {
        const processed = process(r);
        if (processed) processed.forEach((p) => controller.enqueue(p));
      });
    },
  });
};
