import type { ProviderResponseDiagnostics } from '../types/providerDiagnostics';

const MAX_RECORDED_ERROR_MESSAGE_LENGTH = 500;
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
  const serializedEvent = serializeProviderEvent(event);
  const recordedByteLength = diagnostics.rawEventByteLength ?? 0;
  if (
    diagnostics.rawEvents.length >= MAX_RECORDED_RAW_EVENTS ||
    recordedByteLength + serializedEvent.byteLength > MAX_RECORDED_RAW_EVENT_BYTES
  ) {
    diagnostics.droppedRawEventCount = (diagnostics.droppedRawEventCount ?? 0) + 1;
    return;
  }

  diagnostics.rawEvents.push(serializedEvent.value);
  diagnostics.rawEventByteLength = recordedByteLength + serializedEvent.byteLength;
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
