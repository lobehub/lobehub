import type Anthropic from '@anthropic-ai/sdk';

import type {
  ModelRuntimeDiagnostics,
  ProviderResponseDiagnostics,
  ProviderResponseEventDiagnostics,
} from '../../types/providerDiagnostics';
import {
  appendRawProviderEvent,
  captureRawProviderResponse,
  waitForRawProviderResponse,
} from '../providerDiagnostics';

const MAX_RECORDED_PROVIDER_EVENTS = 128;
const MAX_RECORDED_ERROR_MESSAGE_LENGTH = 500;
const RESPONSE_HEADER_NAMES = [
  'anthropic-request-id',
  'cf-ray',
  'content-length',
  'content-type',
  'date',
  'request-id',
  'server-timing',
  'trace-id',
  'x-aihubmix-request-id',
  'x-ds-trace-id',
  'x-request-id',
  'x-stainless-request-id',
  'x-trace-id',
] as const;

interface InitializeAnthropicDiagnosticsParams {
  diagnostics?: ModelRuntimeDiagnostics;
  endpoint?: string;
  payload: Anthropic.MessageCreateParams;
  sentAt: number;
}

interface AnthropicResponseMetadata {
  requestId?: string | null;
  response?: Response;
}

const appendEvent = (
  diagnostics: ProviderResponseDiagnostics,
  event: Omit<ProviderResponseEventDiagnostics, 'index'>,
) => {
  const indexedEvent = { ...event, index: diagnostics.eventCount };
  diagnostics.eventCount += 1;

  const eventKey = [event.type, event.blockType, event.deltaType].filter(Boolean).join(':');
  diagnostics.eventCounts[eventKey] = (diagnostics.eventCounts[eventKey] ?? 0) + 1;

  if (diagnostics.events.length >= MAX_RECORDED_PROVIDER_EVENTS) {
    diagnostics.events.shift();
    diagnostics.droppedEventCount += 1;
  }
  diagnostics.events.push(indexedEvent);
};

const recordStringContent = (
  diagnostics: ProviderResponseDiagnostics,
  event: Omit<ProviderResponseEventDiagnostics, 'index'>,
  content: string,
  kind: 'signature' | 'text' | 'thinking' | 'toolInput',
) => {
  if (kind === 'signature') {
    diagnostics.signatureChars += content.length;
    event.signatureLength = content.length;
    return;
  }

  const hasNonWhitespaceContent = content.trim().length > 0;
  event.contentLength = content.length;
  event.hasNonWhitespaceContent = hasNonWhitespaceContent;

  if (kind === 'text') {
    diagnostics.textChars += content.length;
    diagnostics.hasNonWhitespaceText ||= hasNonWhitespaceContent;
  }
  if (kind === 'thinking') {
    diagnostics.thinkingChars += content.length;
    diagnostics.hasNonWhitespaceThinking ||= hasNonWhitespaceContent;
  }
  if (kind === 'toolInput') diagnostics.toolInputChars += content.length;

  if (hasNonWhitespaceContent && diagnostics.firstNonWhitespaceOutputAt === undefined) {
    diagnostics.firstNonWhitespaceOutputAt = Date.now();
  }
};

const recordError = (diagnostics: ProviderResponseDiagnostics, error: unknown) => {
  diagnostics.error = {
    message:
      error instanceof Error
        ? error.message.slice(0, MAX_RECORDED_ERROR_MESSAGE_LENGTH)
        : undefined,
    name: error instanceof Error ? error.name : undefined,
  };
};

const finalizeResponse = async (diagnostics: ProviderResponseDiagnostics, signal?: AbortSignal) => {
  await waitForRawProviderResponse(diagnostics);
  diagnostics.aborted = signal?.aborted || undefined;
  diagnostics.completedAt ??= Date.now();
};

const recordMessageContentBlock = (
  diagnostics: ProviderResponseDiagnostics,
  block: Anthropic.ContentBlock,
  index: number,
) => {
  const event: Omit<ProviderResponseEventDiagnostics, 'index'> = {
    blockIndex: index,
    blockType: block.type,
    type: 'content_block_start',
  };

  if (block.type === 'text') recordStringContent(diagnostics, event, block.text, 'text');
  if (block.type === 'thinking') {
    recordStringContent(diagnostics, event, block.thinking, 'thinking');
    recordStringContent(diagnostics, event, block.signature, 'signature');
  }
  if (block.type === 'redacted_thinking') {
    recordStringContent(diagnostics, event, block.data, 'signature');
  }
  if (block.type === 'tool_use' || block.type === 'server_tool_use') {
    diagnostics.toolUseCount += 1;
    diagnostics.firstNonWhitespaceOutputAt ??= Date.now();
  }

  appendEvent(diagnostics, event);
};

export const initializeAnthropicDiagnostics = ({
  diagnostics,
  endpoint,
  payload,
  sentAt,
}: InitializeAnthropicDiagnosticsParams): ProviderResponseDiagnostics | undefined => {
  if (!diagnostics) return;

  const providerResponse: ProviderResponseDiagnostics = {
    apiMode: 'messages',
    droppedEventCount: 0,
    endpoint,
    eventCount: 0,
    eventCounts: {},
    events: [],
    hasNonWhitespaceText: false,
    hasNonWhitespaceThinking: false,
    rawEvents: [],
    signatureChars: 0,
    terminalEventReceived: false,
    textChars: 0,
    thinkingChars: 0,
    toolInputChars: 0,
    toolUseCount: 0,
  };
  diagnostics.providerRequest = {
    apiMode: 'messages',
    endpoint,
    payload,
    sentAt,
  };
  diagnostics.providerResponse = providerResponse;
  return providerResponse;
};

export const recordAnthropicResponseMetadata = (
  diagnostics: ProviderResponseDiagnostics | undefined,
  { requestId, response }: AnthropicResponseMetadata,
) => {
  if (!diagnostics) return;

  diagnostics.responseReceivedAt = Date.now();
  diagnostics.requestId = requestId ?? undefined;
  diagnostics.status = response?.status;
  captureRawProviderResponse(diagnostics, response);

  if (!response) return;

  const headers: Record<string, string> = {};
  for (const headerName of RESPONSE_HEADER_NAMES) {
    const value = response.headers.get(headerName);
    if (value) headers[headerName] = value;
  }
  if (Object.keys(headers).length > 0) diagnostics.headers = headers;
  diagnostics.requestId ??=
    headers['request-id'] ??
    headers['anthropic-request-id'] ??
    headers['x-request-id'] ??
    headers['x-aihubmix-request-id'] ??
    headers['x-stainless-request-id'];
};

export const recordAnthropicStreamEvent = (
  diagnostics: ProviderResponseDiagnostics,
  chunk: Anthropic.MessageStreamEvent,
) => {
  appendRawProviderEvent(diagnostics, chunk);
  const event: Omit<ProviderResponseEventDiagnostics, 'index'> = { type: chunk.type };
  diagnostics.firstEventAt ??= Date.now();

  switch (chunk.type) {
    case 'message_start': {
      diagnostics.messageId = chunk.message.id;
      diagnostics.model = chunk.message.model;
      diagnostics.usage = chunk.message.usage;
      break;
    }
    case 'content_block_start': {
      event.blockIndex = chunk.index;
      event.blockType = chunk.content_block.type;
      const block = chunk.content_block;
      if (block.type === 'text') recordStringContent(diagnostics, event, block.text, 'text');
      if (block.type === 'thinking') {
        recordStringContent(diagnostics, event, block.thinking, 'thinking');
        recordStringContent(diagnostics, event, block.signature, 'signature');
      }
      if (block.type === 'redacted_thinking') {
        recordStringContent(diagnostics, event, block.data, 'signature');
      }
      if (block.type === 'tool_use' || block.type === 'server_tool_use') {
        diagnostics.toolUseCount += 1;
        diagnostics.firstNonWhitespaceOutputAt ??= Date.now();
      }
      break;
    }
    case 'content_block_delta': {
      event.blockIndex = chunk.index;
      event.deltaType = chunk.delta.type;
      if (chunk.delta.type === 'text_delta') {
        recordStringContent(diagnostics, event, chunk.delta.text, 'text');
      }
      if (chunk.delta.type === 'thinking_delta') {
        recordStringContent(diagnostics, event, chunk.delta.thinking, 'thinking');
      }
      if (chunk.delta.type === 'signature_delta') {
        recordStringContent(diagnostics, event, chunk.delta.signature, 'signature');
      }
      if (chunk.delta.type === 'input_json_delta') {
        recordStringContent(diagnostics, event, chunk.delta.partial_json, 'toolInput');
      }
      break;
    }
    case 'message_delta': {
      diagnostics.stopReason = chunk.delta.stop_reason;
      diagnostics.stopSequence = chunk.delta.stop_sequence;
      diagnostics.usage = chunk.usage;
      break;
    }
    case 'message_stop': {
      diagnostics.terminalEventReceived = true;
      break;
    }
  }

  appendEvent(diagnostics, event);
};

const observeAsyncIterable = async function* (
  stream: AsyncIterable<Anthropic.MessageStreamEvent>,
  diagnostics: ProviderResponseDiagnostics,
  signal?: AbortSignal,
) {
  try {
    for await (const chunk of stream) {
      recordAnthropicStreamEvent(diagnostics, chunk);
      yield chunk;
    }
  } catch (error) {
    recordError(diagnostics, error);
    throw error;
  } finally {
    await finalizeResponse(diagnostics, signal);
  }
};

const observeReadableStream = (
  stream: ReadableStream<Anthropic.MessageStreamEvent>,
  diagnostics: ProviderResponseDiagnostics,
  signal?: AbortSignal,
) => {
  const reader = stream.getReader();

  return new ReadableStream<Anthropic.MessageStreamEvent>({
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } catch (error) {
        recordError(diagnostics, error);
        throw error;
      } finally {
        await finalizeResponse(diagnostics, signal);
      }
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          await finalizeResponse(diagnostics, signal);
          controller.close();
          return;
        }

        recordAnthropicStreamEvent(diagnostics, value);
        controller.enqueue(value);
      } catch (error) {
        recordError(diagnostics, error);
        await finalizeResponse(diagnostics, signal);
        controller.error(error);
      }
    },
  });
};

export const observeAnthropicStream = (
  stream:
    AsyncIterable<Anthropic.MessageStreamEvent> | ReadableStream<Anthropic.MessageStreamEvent>,
  diagnostics: ProviderResponseDiagnostics,
  signal?: AbortSignal,
) =>
  stream instanceof ReadableStream
    ? observeReadableStream(stream, diagnostics, signal)
    : observeAsyncIterable(stream, diagnostics, signal);

export const recordAnthropicNonStreamingResponse = async (
  diagnostics: ProviderResponseDiagnostics | undefined,
  message: Anthropic.Message,
  signal?: AbortSignal,
) => {
  if (!diagnostics) return;

  diagnostics.firstEventAt ??= Date.now();
  diagnostics.messageId = message.id;
  diagnostics.model = message.model;
  appendRawProviderEvent(diagnostics, message);
  diagnostics.usage = message.usage;
  diagnostics.stopReason = message.stop_reason;
  diagnostics.stopSequence = message.stop_sequence;
  appendEvent(diagnostics, { type: 'message_start' });
  message.content.forEach((block, index) => recordMessageContentBlock(diagnostics, block, index));
  appendEvent(diagnostics, { type: 'message_delta' });
  appendEvent(diagnostics, { type: 'message_stop' });
  diagnostics.terminalEventReceived = true;
  await finalizeResponse(diagnostics, signal);
};
