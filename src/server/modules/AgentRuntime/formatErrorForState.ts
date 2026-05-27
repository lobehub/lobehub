import { getErrorCodeSpec } from '@lobechat/model-runtime';
import { AgentRuntimeErrorType, ChatErrorType, type ChatMessageError } from '@lobechat/types';

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
  // `getErrorCodeSpec` is keyed by `ILobeAgentRuntimeErrorType` strings; coerce
  // because `ChatMessageError['type']` widens to include numeric `ChatErrorType`
  // values, which simply miss the lookup and pass through unenriched.
  const spec = getErrorCodeSpec(String(formatted.type));
  if (!spec) return formatted;

  return {
    ...formatted,
    attribution: spec.attribution,
    category: spec.category,
    countAsFailure: spec.countAsFailure,
    httpStatus: spec.httpStatus,
    numericId: spec.numericId,
    retryable: spec.retryable,
    severity: spec.severity,
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
    const payload = error as {
      error?: unknown;
      errorType: ChatMessageError['type'];
      message?: string;
    };
    return enrichWithSpec({
      body: payload.error || error,
      message: payload.message || String(payload.errorType),
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
