import type OpenAI from 'openai';

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
  'cf-ray',
  'content-length',
  'content-type',
  'date',
  'openai-processing-ms',
  'openai-request-id',
  'request-id',
  'server-timing',
  'trace-id',
  'x-aihubmix-request-id',
  'x-request-id',
  'x-stainless-request-id',
  'x-trace-id',
] as const;

type OpenAIAPIMode = 'chat_completions' | 'responses';

interface InitializeOpenAIDiagnosticsParams {
  apiMode: OpenAIAPIMode;
  diagnostics?: ModelRuntimeDiagnostics;
  endpoint?: string;
  payload: unknown;
  sentAt: number;
}

interface OpenAIResponseMetadata {
  requestId?: string | null;
  response?: Response;
}

export interface OpenAIResponseWithMetadata<T> {
  data: T;
  request_id?: string | null;
  response?: Response;
}

type OpenAIResponsePromise<T> = PromiseLike<T> & {
  withResponse?: () => Promise<OpenAIResponseWithMetadata<T>>;
};

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
  kind: 'text' | 'thinking' | 'toolInput',
) => {
  const hasNonWhitespaceContent = content.trim().length > 0;
  event.contentLength = (event.contentLength ?? 0) + content.length;
  event.hasNonWhitespaceContent ||= hasNonWhitespaceContent;

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

const getString = (value: unknown) => (typeof value === 'string' ? value : undefined);

const recordResponseIdentity = (
  diagnostics: ProviderResponseDiagnostics,
  response: Record<string, unknown> | undefined,
) => {
  if (!response) return;

  diagnostics.messageId ??= getString(response.id);
  diagnostics.model ??= getString(response.model);
  diagnostics.stopReason ??= getString(response.status);
  if (response.usage !== undefined) diagnostics.usage = response.usage;
};

export const initializeOpenAIDiagnostics = ({
  apiMode,
  diagnostics,
  endpoint,
  payload,
  sentAt,
}: InitializeOpenAIDiagnosticsParams): ProviderResponseDiagnostics | undefined => {
  if (!diagnostics) return;

  const providerResponse: ProviderResponseDiagnostics = {
    apiMode,
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
  diagnostics.providerRequest = { apiMode, endpoint, payload, sentAt };
  diagnostics.providerResponse = providerResponse;

  return providerResponse;
};

export const resolveOpenAIResponseWithMetadata = async <T>(
  responsePromise: OpenAIResponsePromise<T>,
): Promise<OpenAIResponseWithMetadata<T>> =>
  typeof responsePromise.withResponse === 'function'
    ? responsePromise.withResponse()
    : { data: await responsePromise };

export const recordOpenAIResponseMetadata = (
  diagnostics: ProviderResponseDiagnostics | undefined,
  { requestId, response }: OpenAIResponseMetadata,
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
    headers['openai-request-id'] ??
    headers['request-id'] ??
    headers['x-request-id'] ??
    headers['x-aihubmix-request-id'] ??
    headers['x-stainless-request-id'];
};

export const recordOpenAIChatCompletionChunk = (
  diagnostics: ProviderResponseDiagnostics,
  chunk: OpenAI.Chat.Completions.ChatCompletionChunk,
) => {
  appendRawProviderEvent(diagnostics, chunk);
  diagnostics.firstEventAt ??= Date.now();
  diagnostics.messageId ??= chunk.id;
  diagnostics.model ??= chunk.model;
  if (chunk.usage) diagnostics.usage = chunk.usage;

  const event: Omit<ProviderResponseEventDiagnostics, 'index'> = {
    type: chunk.object || 'chat.completion.chunk',
  };

  for (const choice of chunk.choices) {
    const delta = choice.delta as typeof choice.delta & {
      reasoning?: string;
      reasoning_content?: string;
    };

    if (typeof delta.content === 'string') {
      recordStringContent(diagnostics, event, delta.content, 'text');
    }

    const reasoning = delta.reasoning_content ?? delta.reasoning;
    if (typeof reasoning === 'string') {
      recordStringContent(diagnostics, event, reasoning, 'thinking');
    }

    for (const toolCall of delta.tool_calls ?? []) {
      if (toolCall.id || toolCall.function?.name) {
        diagnostics.toolUseCount += 1;
        diagnostics.firstNonWhitespaceOutputAt ??= Date.now();
      }
      if (typeof toolCall.function?.arguments === 'string') {
        recordStringContent(diagnostics, event, toolCall.function.arguments, 'toolInput');
      }
    }

    if (choice.finish_reason) {
      diagnostics.stopReason = choice.finish_reason;
      diagnostics.terminalEventReceived = true;
    }
  }

  appendEvent(diagnostics, event);
};

export const recordOpenAIResponseStreamEvent = (
  diagnostics: ProviderResponseDiagnostics,
  chunk: OpenAI.Responses.ResponseStreamEvent,
) => {
  appendRawProviderEvent(diagnostics, chunk);
  diagnostics.firstEventAt ??= Date.now();

  const rawChunk = chunk as unknown as Record<string, unknown>;
  const type = getString(rawChunk.type) ?? 'unknown';
  const event: Omit<ProviderResponseEventDiagnostics, 'index'> = { type };
  const response =
    rawChunk.response && typeof rawChunk.response === 'object'
      ? (rawChunk.response as Record<string, unknown>)
      : undefined;
  recordResponseIdentity(diagnostics, response);

  if (type === 'response.output_text.delta' || type === 'response.output_text.done') {
    const content = getString(type.endsWith('.delta') ? rawChunk.delta : rawChunk.text);
    if (content) recordStringContent(diagnostics, event, content, 'text');
  }

  if (
    type === 'response.reasoning_summary_text.delta' ||
    type === 'response.reasoning_text.delta'
  ) {
    const content = getString(rawChunk.delta);
    if (content) recordStringContent(diagnostics, event, content, 'thinking');
  }

  if (type === 'response.output_item.added') {
    const item =
      rawChunk.item && typeof rawChunk.item === 'object'
        ? (rawChunk.item as Record<string, unknown>)
        : undefined;
    if (item?.type === 'function_call') {
      diagnostics.toolUseCount += 1;
      diagnostics.firstNonWhitespaceOutputAt ??= Date.now();
    }
  }

  if (type === 'response.function_call_arguments.delta') {
    const content = getString(rawChunk.delta);
    if (content) recordStringContent(diagnostics, event, content, 'toolInput');
  }

  if (
    type === 'response.completed' ||
    type === 'response.failed' ||
    type === 'response.incomplete'
  ) {
    diagnostics.stopReason = getString(response?.status) ?? type.slice('response.'.length);
    diagnostics.terminalEventReceived = true;
  }

  appendEvent(diagnostics, event);
};

const observeAsyncIterable = async function* <T>(
  stream: AsyncIterable<T>,
  diagnostics: ProviderResponseDiagnostics,
  recordEvent: (diagnostics: ProviderResponseDiagnostics, event: T) => void,
  signal?: AbortSignal,
) {
  try {
    for await (const chunk of stream) {
      recordEvent(diagnostics, chunk);
      yield chunk;
    }
  } catch (error) {
    recordError(diagnostics, error);
    throw error;
  } finally {
    await finalizeResponse(diagnostics, signal);
  }
};

const observeReadableStream = <T>(
  stream: ReadableStream<T>,
  diagnostics: ProviderResponseDiagnostics,
  recordEvent: (diagnostics: ProviderResponseDiagnostics, event: T) => void,
  signal?: AbortSignal,
) => {
  const reader = stream.getReader();

  return new ReadableStream<T>({
    async cancel(reason) {
      await reader.cancel(reason);
      await finalizeResponse(diagnostics, signal);
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          await finalizeResponse(diagnostics, signal);
          controller.close();
          return;
        }

        recordEvent(diagnostics, value);
        controller.enqueue(value);
      } catch (error) {
        recordError(diagnostics, error);
        await finalizeResponse(diagnostics, signal);
        controller.error(error);
      }
    },
  });
};

export const observeOpenAIChatCompletionStream = (
  stream:
    | AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
    | ReadableStream<OpenAI.Chat.Completions.ChatCompletionChunk>,
  diagnostics: ProviderResponseDiagnostics,
  signal?: AbortSignal,
) =>
  stream instanceof ReadableStream
    ? observeReadableStream(stream, diagnostics, recordOpenAIChatCompletionChunk, signal)
    : observeAsyncIterable(stream, diagnostics, recordOpenAIChatCompletionChunk, signal);

export const observeOpenAIResponsesStream = (
  stream:
    | AsyncIterable<OpenAI.Responses.ResponseStreamEvent>
    | ReadableStream<OpenAI.Responses.ResponseStreamEvent>,
  diagnostics: ProviderResponseDiagnostics,
  signal?: AbortSignal,
) =>
  stream instanceof ReadableStream
    ? observeReadableStream(stream, diagnostics, recordOpenAIResponseStreamEvent, signal)
    : observeAsyncIterable(stream, diagnostics, recordOpenAIResponseStreamEvent, signal);

export const recordOpenAIChatCompletionResponse = async (
  diagnostics: ProviderResponseDiagnostics | undefined,
  completion: OpenAI.ChatCompletion,
  signal?: AbortSignal,
) => {
  if (!diagnostics) return;

  appendRawProviderEvent(diagnostics, completion);
  diagnostics.firstEventAt ??= Date.now();
  diagnostics.messageId = completion.id;
  diagnostics.model = completion.model;
  diagnostics.usage = completion.usage;

  const event: Omit<ProviderResponseEventDiagnostics, 'index'> = {
    type: completion.object,
  };
  for (const choice of completion.choices) {
    const message = choice.message as typeof choice.message & {
      reasoning?: string;
      reasoning_content?: string;
    };
    if (typeof message.content === 'string') {
      recordStringContent(diagnostics, event, message.content, 'text');
    }
    const reasoning = message.reasoning_content ?? message.reasoning;
    if (typeof reasoning === 'string') {
      recordStringContent(diagnostics, event, reasoning, 'thinking');
    }
    for (const toolCall of message.tool_calls ?? []) {
      diagnostics.toolUseCount += 1;
      diagnostics.firstNonWhitespaceOutputAt ??= Date.now();
      if (toolCall.type === 'function') {
        recordStringContent(diagnostics, event, toolCall.function.arguments, 'toolInput');
      }
    }
    if (choice.finish_reason) diagnostics.stopReason = choice.finish_reason;
  }
  appendEvent(diagnostics, event);
  diagnostics.terminalEventReceived = true;
  await finalizeResponse(diagnostics, signal);
};

export const recordOpenAIResponsesResponse = async (
  diagnostics: ProviderResponseDiagnostics | undefined,
  response: OpenAI.Responses.Response,
  signal?: AbortSignal,
) => {
  if (!diagnostics) return;

  appendRawProviderEvent(diagnostics, response);
  diagnostics.firstEventAt ??= Date.now();
  recordResponseIdentity(diagnostics, response as unknown as Record<string, unknown>);
  diagnostics.terminalEventReceived = true;
  appendEvent(diagnostics, { type: `response.${response.status}` });
  await finalizeResponse(diagnostics, signal);
};
