import type { ProviderResponseDiagnostics } from '../types/providerDiagnostics';

const MAX_RECORDED_ERROR_MESSAGE_LENGTH = 500;
const rawResponseCaptureTasks = new WeakMap<ProviderResponseDiagnostics, Promise<void>>();

/**
 * Provider SDK events originate from JSON but compatible clients may attach
 * BigInt values or circular references. Normalize each event at the provider
 * boundary so a diagnostic record can never make Redis serialization fail.
 */
const toJsonSafeProviderEvent = (value: unknown): unknown => {
  const seen = new WeakSet<object>();

  try {
    const serialized = JSON.stringify(value, (_key, item) => {
      if (typeof item === 'bigint') return item.toString();
      if (typeof item === 'object' && item !== null) {
        if (seen.has(item)) return '[Circular]';
        seen.add(item);
      }

      return item;
    });

    return serialized === undefined ? String(value) : JSON.parse(serialized);
  } catch (error) {
    return {
      serializationError: error instanceof Error ? error.message : String(error),
    };
  }
};

export const appendRawProviderEvent = (
  diagnostics: ProviderResponseDiagnostics,
  event: unknown,
) => {
  diagnostics.rawEvents.push(toJsonSafeProviderEvent(event));
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
    const captureTask = responseClone
      .text()
      .then((body) => {
        diagnostics.rawResponse = {
          body,
          byteLength: new TextEncoder().encode(body).byteLength,
          status: 'captured',
        };
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
