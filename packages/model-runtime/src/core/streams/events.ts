import type { ModelPerformance, ModelReasoningResponseItem, ModelUsage } from '@lobechat/types';

import { parseToolCalls } from '../../helpers';
import type { ChatStreamCallbacks, OnFinishData } from '../../types';
import { AgentRuntimeErrorType } from '../../types/error';
import { nanoid } from '../../utils/uuid';
import type {
  StreamContext,
  StreamPartChunkData,
  StreamProtocolChunk,
  StreamToolCallChunkData,
} from './protocol';

export interface ModelStreamEventDataMap {
  base64_image: string | { image: { data: string; id: string } };
  content_part: StreamPartChunkData;
  data: unknown;
  error: unknown;
  flagged_reasoning_signature: unknown;
  grounding: unknown;
  reasoning: string;
  reasoning_part: StreamPartChunkData;
  reasoning_response_item: ModelReasoningResponseItem;
  reasoning_signature: string;
  speed: ModelPerformance;
  stop: unknown;
  text: string;
  tool_calls: StreamToolCallChunkData[];
  usage: ModelUsage;
}

/**
 * The provider-neutral chat stream contract. SSE is only its wire encoding, applied once
 * at the end of a pipeline by `createSSEEncoder`.
 */
export type ModelStreamEvent = {
  [Type in keyof ModelStreamEventDataMap]: {
    data: ModelStreamEventDataMap[Type];
    id?: string;
    type: Type;
  };
}[keyof ModelStreamEventDataMap];

/** Accumulates a stream's events and fires the chat callbacks for each of them. */
export const createStreamCallbackDispatcher = (
  cb: ChatStreamCallbacks | undefined,
  options?: { streamStack?: StreamContext },
) => {
  let aggregatedText = '';
  let aggregatedThinking: string | undefined = undefined;
  let reasoningSignature: string | undefined;
  const reasoningResponseItems: ModelReasoningResponseItem[] = [];
  let usage: ModelUsage | undefined;
  let speed: ModelPerformance | undefined;
  let grounding: any;
  let toolsCalling: any;
  let streamError: any;
  let finishReason: string | undefined;
  // Track base64 images for accumulation
  const base64Images: Array<{ data: string; id: string }> = [];

  const callbacks = cb || {};

  const finish = async (): Promise<void> => {
    /**
     * Non-streaming Responses conversion emits reasoning items without summary
     * deltas, so derive visible thinking text from the item summaries whenever
     * nothing was streamed — otherwise the summary would persist but never render.
     */
    const responseItemsThinking = reasoningResponseItems
      .flatMap(({ summary }) => summary ?? [])
      .map(({ text }) => text)
      .filter(Boolean)
      .join('\n');
    const reasoningContent = aggregatedThinking || responseItemsThinking || undefined;

    const data: OnFinishData = {
      error: streamError,
      finishReason,
      grounding,
      speed,
      text: aggregatedText,
      thinking: reasoningContent,
      toolsCalling,
      usage,
    };
    if (reasoningContent || reasoningSignature || reasoningResponseItems.length > 0) {
      data.reasoning = {
        content: reasoningContent,
        responseItems: reasoningResponseItems.length > 0 ? reasoningResponseItems : undefined,
        signature: reasoningSignature,
      };
    }
    const usageMissingDiagnostics = usage
      ? undefined
      : options?.streamStack?.usageMissingDiagnostics;
    if (usageMissingDiagnostics) data.usageMissingDiagnostics = usageMissingDiagnostics;
    const { pricingOptions, providerReportedCost } = options?.streamStack ?? {};
    if (providerReportedCost !== undefined) data.providerReportedCost = providerReportedCost;
    if (pricingOptions) data.pricingOptions = pricingOptions;

    if (callbacks.onCompletion) {
      await callbacks.onCompletion(data);
    }

    if (callbacks.onFinal) {
      await callbacks.onFinal(data);
    }
  };

  const dispatch = async (event: ModelStreamEvent): Promise<void> => {
    const data = event.data as any;

    if (!data) return;

    switch (event.type) {
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

      case 'reasoning_signature': {
        if (typeof data === 'string') reasoningSignature = data;
        break;
      }

      case 'reasoning_response_item': {
        reasoningResponseItems.push(data as ModelReasoningResponseItem);
        break;
      }

      case 'base64_image': {
        // Real providers (google/openai image streams) serialize `data` as a
        // raw data-URI string; wrap it into an image item, mirroring
        // fetch-sse's client-side parser so both paths share one contract.
        // Tolerate the legacy `{ image, images }` object shape too, so any
        // existing consumer keeps working.
        const image =
          typeof data === 'string'
            ? { data, id: `tmp_img_${nanoid()}` }
            : (data as { image: { data: string; id: string } }).image;
        base64Images.push(image);
        await callbacks.onBase64Image?.({
          image,
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
        break;
      }

      case 'stop': {
        // Provider's terminal finishReason (e.g. Google's RECITATION / MAX_TOKENS,
        // OpenAI's length, Anthropic's end_turn). Capture so downstream consumers
        // can detect soft interrupts where content is empty but tokens were billed.
        //
        // Some providers emit multiple stop chunks per stream — Anthropic sends
        // `message_delta` (carrying the real `stop_reason` like `end_turn` /
        // `max_tokens` / `tool_use`) followed by a `message_stop` sentinel.
        // Keep the FIRST non-empty value so the meaningful reason is not
        // clobbered by the trailing sentinel.
        if (typeof data === 'string' && data && !finishReason) {
          finishReason = data;
        }
        break;
      }

      case 'error': {
        streamError = data;
        await callbacks.onError?.(data);
        break;
      }
    }
  };

  return { dispatch, finish, start: async () => callbacks.onStart?.() };
};

/**
 * Convert provider chunks into model stream events, closing with an error event when
 * `requireTerminalEvent` is set and the upstream ended without one.
 */
export const createModelEventTransformer = (
  transformer: (chunk: any, stack: StreamContext) => StreamProtocolChunk | StreamProtocolChunk[],
  streamStack?: StreamContext,
  options?: { requireTerminalEvent?: boolean },
) => {
  let hasTerminalEvent = false;

  return new TransformStream<any, ModelStreamEvent>({
    flush(controller) {
      if (!options?.requireTerminalEvent || hasTerminalEvent) return;

      // The provider cut the response short; no chunk failed to parse, so this is not a
      // `StreamChunkError`.
      controller.enqueue({
        data: {
          body: { name: 'Stream parsing error', reason: 'unexpected_end' },
          message: 'Stream ended unexpectedly',
          name: 'Stream parsing error',
          type: AgentRuntimeErrorType.ProviderStreamInterrupted,
        },
        id: streamStack?.id || 'stream_end',
        type: 'error',
      });
    },
    transform: (chunk, controller) => {
      const result = transformer(chunk, streamStack || { id: '' });

      for (const event of Array.isArray(result) ? result : [result]) {
        controller.enqueue(event as ModelStreamEvent);

        // mark terminal when receiving any of these events
        if (event.type === 'stop' || event.type === 'usage' || event.type === 'error') {
          hasTerminalEvent = true;
        }
      }
    },
  });
};

/** Fires chat callbacks for each event, forwarding the event before its callback resolves. */
export const createEventCallbacksTransformer = (
  cb: ChatStreamCallbacks | undefined,
  options?: { streamStack?: StreamContext },
) => {
  const dispatcher = createStreamCallbackDispatcher(cb, options);

  return new TransformStream<ModelStreamEvent, ModelStreamEvent>({
    flush: () => dispatcher.finish(),
    start: async () => {
      await dispatcher.start();
    },
    transform: async (event, controller) => {
      controller.enqueue(event);
      await dispatcher.dispatch(event);
    },
  });
};

/** Encode model stream events as the SSE bytes sent to clients. */
export const createSSEEncoder = () => {
  const textEncoder = new TextEncoder();

  return new TransformStream<ModelStreamEvent, Uint8Array>({
    transform: ({ data, id, type }, controller) => {
      controller.enqueue(textEncoder.encode(`id: ${id}\n`));
      controller.enqueue(textEncoder.encode(`event: ${type}\n`));
      controller.enqueue(textEncoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    },
  });
};
