import type {
  ModelRuntimeDiagnostics,
  ProviderResponseDiagnostics,
  ProviderResponseEventDiagnostics,
} from '../types/providerDiagnostics';

const MAX_RECORDED_ERROR_MESSAGE_LENGTH = 500;
const MAX_RECORDED_PROVIDER_EVENTS = 128;
const MAX_RECORDED_RAW_EVENT_BYTES = 256 * 1024;
const MAX_RECORDED_RAW_EVENTS = 128;
const MAX_RECORDED_RAW_RESPONSE_BYTES = 256 * 1024;
const rawResponseCaptureTasks = new WeakMap<ProviderResponseDiagnostics, Promise<void>>();

/**
 * Provider SDK events originate from JSON but compatible clients may attach
 * BigInt values or circular references. Normalize each event at the provider
 * boundary so a diagnostic record can never make Redis serialization fail.
 */
const serializeProviderEvent = (value: unknown): { byteLength: number; value: unknown } => {
  const seen = new WeakSet<object>();

  try {
    const serializedValue = JSON.stringify(value, (_key, item) => {
      if (typeof item === 'bigint') return item.toString();
      if (typeof item === 'object' && item !== null) {
        if (seen.has(item)) return '[Circular]';
        seen.add(item);
      }

      return item;
    });
    const serialized = serializedValue ?? JSON.stringify(String(value));

    return {
      byteLength: new TextEncoder().encode(serialized).byteLength,
      value: JSON.parse(serialized),
    };
  } catch (error) {
    const fallback = {
      serializationError: (error instanceof Error ? error.message : String(error)).slice(
        0,
        MAX_RECORDED_ERROR_MESSAGE_LENGTH,
      ),
    };
    const serialized = JSON.stringify(fallback);
    return { byteLength: new TextEncoder().encode(serialized).byteLength, value: fallback };
  }
};

export const appendRawProviderEvent = (
  diagnostics: ProviderResponseDiagnostics,
  event: unknown,
) => {
  if (diagnostics.rawEvents.length >= MAX_RECORDED_RAW_EVENTS) {
    diagnostics.droppedRawEventCount = (diagnostics.droppedRawEventCount ?? 0) + 1;
    return;
  }

  const serializedEvent = serializeProviderEvent(event);
  const recordedByteLength = diagnostics.rawEventByteLength ?? 0;
  if (recordedByteLength + serializedEvent.byteLength > MAX_RECORDED_RAW_EVENT_BYTES) {
    diagnostics.droppedRawEventCount = (diagnostics.droppedRawEventCount ?? 0) + 1;
    return;
  }

  diagnostics.rawEvents.push(serializedEvent.value);
  diagnostics.rawEventByteLength = recordedByteLength + serializedEvent.byteLength;
};

interface InitializeProviderDiagnosticsParams {
  apiMode: string;
  diagnostics?: ModelRuntimeDiagnostics;
  endpoint?: string;
  payload: unknown;
  sentAt: number;
}

/** Initialize the shared diagnostic envelope used by custom provider adapters. */
export const initializeProviderDiagnostics = ({
  apiMode,
  diagnostics,
  endpoint,
  payload,
  sentAt,
}: InitializeProviderDiagnosticsParams): ProviderResponseDiagnostics | undefined => {
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
    rawResponse: { status: 'unavailable' },
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

export const appendProviderResponseEvent = (
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

export const recordProviderStringContent = (
  diagnostics: ProviderResponseDiagnostics,
  event: Omit<ProviderResponseEventDiagnostics, 'index'>,
  content: string,
  kind: 'signature' | 'text' | 'thinking' | 'toolInput',
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
  if (kind === 'signature') {
    diagnostics.signatureChars += content.length;
    event.signatureLength = (event.signatureLength ?? 0) + content.length;
  }
  if (kind === 'toolInput') diagnostics.toolInputChars += content.length;

  if (hasNonWhitespaceContent && diagnostics.firstNonWhitespaceOutputAt === undefined) {
    diagnostics.firstNonWhitespaceOutputAt = Date.now();
  }
};

export const recordProviderError = (
  diagnostics: ProviderResponseDiagnostics | undefined,
  error: unknown,
) => {
  if (!diagnostics) return;

  diagnostics.error = {
    message:
      error instanceof Error
        ? error.message.slice(0, MAX_RECORDED_ERROR_MESSAGE_LENGTH)
        : String(error).slice(0, MAX_RECORDED_ERROR_MESSAGE_LENGTH),
    name: error instanceof Error ? error.name : undefined,
  };
};

export const finalizeProviderResponse = async (
  diagnostics: ProviderResponseDiagnostics | undefined,
  signal?: AbortSignal,
) => {
  if (!diagnostics) return;

  await waitForRawProviderResponse(diagnostics);
  diagnostics.aborted = signal?.aborted || undefined;
  diagnostics.completedAt ??= Date.now();
};

export const observeProviderAsyncIterable = async function* <T>(
  stream: AsyncIterable<T>,
  diagnostics: ProviderResponseDiagnostics | undefined,
  recordEvent: (diagnostics: ProviderResponseDiagnostics, event: T) => void,
  signal?: AbortSignal,
) {
  if (!diagnostics) {
    yield* stream;
    return;
  }

  try {
    for await (const chunk of stream) {
      recordEvent(diagnostics, chunk);
      yield chunk;
    }
  } catch (error) {
    recordProviderError(diagnostics, error);
    throw error;
  } finally {
    await finalizeProviderResponse(diagnostics, signal);
  }
};

/** Observe a Web stream without teeing or reading ahead of its consumer. */
export const observeProviderReadableStream = <T>(
  stream: ReadableStream<T>,
  diagnostics: ProviderResponseDiagnostics | undefined,
  recordEvent: (diagnostics: ProviderResponseDiagnostics, event: T) => void,
  signal?: AbortSignal,
): ReadableStream<T> => {
  if (!diagnostics) return stream;

  const reader = stream.getReader();
  let finalized = false;
  const finalize = async () => {
    if (finalized) return;
    finalized = true;
    await finalizeProviderResponse(diagnostics, signal);
  };

  return new ReadableStream<T>(
    {
      async cancel(reason) {
        try {
          await reader.cancel(reason);
        } finally {
          await finalize();
        }
      },
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            await finalize();
            controller.close();
            return;
          }

          recordEvent(diagnostics, value);
          controller.enqueue(value);
        } catch (error) {
          recordProviderError(diagnostics, error);
          await finalize();
          controller.error(error);
        }
      },
    },
    { highWaterMark: 0 },
  );
};

/** Read only a bounded prefix so diagnostic capture cannot buffer an unbounded clone. */
const readRawResponseBody = async (response: Response) => {
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const remainingBytes = MAX_RECORDED_RAW_RESPONSE_BYTES - byteLength;
    if (value.byteLength > remainingBytes) {
      if (remainingBytes > 0) chunks.push(value.subarray(0, remainingBytes));
      byteLength += remainingBytes;
      truncated = true;
      await reader.cancel();
      break;
    }

    chunks.push(value);
    byteLength += value.byteLength;
  }

  const bodyBytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bodyBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return {
    body: new TextDecoder().decode(bodyBytes),
    byteLength,
    status: 'captured' as const,
    truncated: truncated || undefined,
  };
};

/**
 * Clone the Fetch response before the provider SDK starts consuming its body.
 * The clone preserves the original SSE/JSON payload while the SDK-owned branch
 * continues normally. Custom clients without a Fetch response still retain
 * their provider-native parsed events and are marked unavailable here.
 */
export const captureRawProviderResponse = (
  diagnostics: ProviderResponseDiagnostics | undefined,
  response?: Response,
) => {
  if (!diagnostics) return;

  if (!response?.body || response.bodyUsed) {
    diagnostics.rawResponse = { status: 'unavailable' };
    return;
  }

  try {
    const responseClone = response.clone();
    const captureTask = readRawResponseBody(responseClone)
      .then((rawResponse) => {
        diagnostics.rawResponse = rawResponse;
      })
      .catch((error) => {
        diagnostics.rawResponse = {
          captureError:
            error instanceof Error
              ? error.message.slice(0, MAX_RECORDED_ERROR_MESSAGE_LENGTH)
              : String(error).slice(0, MAX_RECORDED_ERROR_MESSAGE_LENGTH),
          status: 'failed',
        };
      });
    rawResponseCaptureTasks.set(diagnostics, captureTask);
  } catch (error) {
    diagnostics.rawResponse = {
      captureError:
        error instanceof Error
          ? error.message.slice(0, MAX_RECORDED_ERROR_MESSAGE_LENGTH)
          : String(error).slice(0, MAX_RECORDED_ERROR_MESSAGE_LENGTH),
      status: 'failed',
    };
  }
};

export const waitForRawProviderResponse = async (
  diagnostics: ProviderResponseDiagnostics | undefined,
) => {
  if (!diagnostics) return;

  await rawResponseCaptureTasks.get(diagnostics);
  rawResponseCaptureTasks.delete(diagnostics);
};
