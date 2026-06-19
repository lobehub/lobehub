import { getErrorCodeSpec, refineErrorCode } from '@lobechat/model-runtime';
import { AgentRuntimeErrorType, ChatErrorType, type ChatMessageError } from '@lobechat/types';
import { isRecord } from '@lobechat/utils';

/** Pull a usable HTTP status out of the nested upstream error object. */
const extractHttpStatus = (body: unknown): number | undefined => {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as { error?: { status?: unknown }; status?: unknown; statusCode?: unknown };
  if (typeof b.status === 'number') return b.status;
  if (typeof b.statusCode === 'number') return b.statusCode;
  if (b.error && typeof b.error === 'object' && typeof b.error.status === 'number') {
    return b.error.status;
  }
  return undefined;
};

const extractProvider = (body: unknown): string | undefined => {
  if (!body || typeof body !== 'object') return undefined;
  const p = (body as { provider?: unknown }).provider;
  return typeof p === 'string' ? p : undefined;
};

const extractMessage = (value: unknown): string | undefined => {
  if (!isRecord(value)) return undefined;

  const message = value.message;
  if (typeof message === 'string' && message) return message;

  const nestedError = value.error;
  if (isRecord(nestedError)) {
    const nestedMessage = nestedError.message;
    if (typeof nestedMessage === 'string' && nestedMessage) return nestedMessage;
  }
};

interface ChatCompletionErrorPayloadLike {
  _responseBody?: unknown;
  budget?: unknown;
  error?: unknown;
  errorType: ChatMessageError['type'];
  message?: string;
  provider?: unknown;
}

const mergePayloadError = (
  sourceBody: Record<string, unknown>,
  payload: ChatCompletionErrorPayloadLike,
): unknown | undefined => {
  if (payload._responseBody === undefined || payload.error === undefined) return undefined;
  if (!('error' in sourceBody)) return payload.error;
  if (isRecord(sourceBody.error) && isRecord(payload.error)) {
    return { ...payload.error, ...sourceBody.error };
  }
};

const buildPayloadBody = (
  payload: ChatCompletionErrorPayloadLike,
  originalError: unknown,
  message: string,
): unknown => {
  // Runtime payloads often keep UI context (for example quota hints) next to
  // `error`, while `error` itself only carries the display message. Merge both
  // layers so normalizing `{ errorType, error }` does not drop the fields the
  // chat error renderer needs later.
  const sourceBody = payload._responseBody ?? payload.error ?? originalError;
  const context: Record<string, unknown> = {};

  if (payload.budget !== undefined) context.budget = payload.budget;
  if (typeof payload.provider === 'string') context.provider = payload.provider;

  if (isRecord(sourceBody)) {
    const payloadError = mergePayloadError(sourceBody, payload);

    return {
      ...sourceBody,
      // `_responseBody` is the display-facing body, but gateway/model-runtime
      // still carries status/provider details in `error` for some failures:
      // `{ _responseBody: { error: { message } }, error: { status: 402 } }`.
      ...(payloadError === undefined ? {} : { error: payloadError }),
      ...(payload.budget !== undefined && !('budget' in sourceBody)
        ? { budget: payload.budget }
        : {}),
      ...(typeof payload.provider === 'string' && !('provider' in sourceBody)
        ? { provider: payload.provider }
        : {}),
      ...('message' in sourceBody ? {} : { message }),
    };
  }

  return {
    ...context,
    ...(sourceBody === undefined ? {} : { error: sourceBody }),
    message,
  };
};

/**
 * Merge classification metadata from `ERROR_CODE_SPECS` onto a normalized
 * `ChatMessageError`. Codes that aren't in the spec table (fallbacks like
 * `InternalServerError`, or numeric ChatErrorType values) pass through
 * unchanged — every classification field stays optional.
 *
 * Keeping enrichment in one place means downstream consumers (`agent_operations.error`
 * JSONB, S3 trace snapshots, agent-gateway WS push, dashboards) all get the
 * same shape without re-running pattern matching themselves.
 */
const enrichWithSpec = (formatted: ChatMessageError): ChatMessageError => {
  // Generic `ProviderBizError` is re-derived from the message / HTTP status into
  // a more specific code before enrichment, so the catch-all doesn't swallow
  // rate-limits, network drops, quota, etc. Specific codes pass through.
  const refined = refineErrorCode({
    errorType: String(formatted.type),
    httpStatus: extractHttpStatus(formatted.body),
    message: formatted.message,
    provider: extractProvider(formatted.body),
  });
  const type = (refined ?? formatted.type) as ChatMessageError['type'];

  // `getErrorCodeSpec` is keyed by `ILobeAgentRuntimeErrorType` strings; coerce
  // because `ChatMessageError['type']` widens to include numeric `ChatErrorType`
  // values, which simply miss the lookup and pass through unenriched.
  const spec = getErrorCodeSpec(String(type));
  if (!spec) return formatted;

  return {
    ...formatted,
    attribution: spec.attribution,
    category: spec.category,
    countAsFailure: spec.countAsFailure,
    httpStatus: spec.httpStatus,
    isFallback: spec.isFallback ?? false,
    numericId: spec.numericId,
    retryable: spec.retryable,
    severity: spec.severity,
    type,
  };
};

/**
 * Normalize an arbitrary thrown value into `ChatMessageError`, then attach
 * classification metadata from `ERROR_CODE_SPECS` so the resulting object
 * is self-describing for everything downstream of the runtime catch block.
 *
 * Handles four input shapes:
 *
 * 1. `ChatCompletionErrorPayload` — what `model-runtime` throws on LLM
 *    failures: `{ errorType, error, provider?, message? }`.
 * 2. Already-normalized `ChatMessageError` (`{ type, message?, body? }`)
 *    — re-enriched in place so the helper is safe to call twice (the inner
 *    `runtime.step()` non-throwing error path and the outer `executeStep`
 *    catch can both run through here without double-wrapping).
 * 3. Standard `Error` instance — wrapped as `InternalServerError`.
 * 4. Anything else — stringified as `AgentRuntimeError`.
 */
export const formatErrorForState = (error: unknown): ChatMessageError => {
  if (error && typeof error === 'object' && 'errorType' in error) {
    const payload = error as ChatCompletionErrorPayloadLike;
    const message =
      (payload.message && payload.message !== 'error' ? payload.message : undefined) ??
      extractMessage(payload._responseBody) ??
      extractMessage(payload.error) ??
      String(payload.errorType);

    return enrichWithSpec({
      body: buildPayloadBody(payload, error, message),
      message,
      type: payload.errorType,
    });
  }

  // Path 2: already-normalized ChatMessageError shape — has `type` but not
  // `errorType`, and isn't a thrown Error instance. Common when the inner
  // runtime.step() catch has already stuffed a partial ChatMessageError into
  // `newState.error` and the outer service is just topping it up.
  if (
    error &&
    typeof error === 'object' &&
    !(error instanceof Error) &&
    'type' in error &&
    (typeof (error as { type: unknown }).type === 'string' ||
      typeof (error as { type: unknown }).type === 'number')
  ) {
    return enrichWithSpec(error as ChatMessageError);
  }

  if (error instanceof Error) {
    return enrichWithSpec({
      body: { name: error.name },
      message: error.message,
      type: ChatErrorType.InternalServerError,
    });
  }

  return enrichWithSpec({
    body: error,
    message: String(error),
    type: AgentRuntimeErrorType.AgentRuntimeError,
  });
};
