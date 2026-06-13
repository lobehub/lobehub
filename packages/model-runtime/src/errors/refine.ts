import {
  AgentRuntimeErrorType,
  ChatErrorType,
  type ILobeAgentRuntimeErrorType,
} from '@lobechat/types';

import { matchErrorPattern } from './match';

/**
 * Error codes generic enough to be worth re-deriving from the message / HTTP
 * status. Specific codes assigned by a provider adapter are left untouched.
 *
 * Besides the `ProviderBizError` upstream catch-all, this covers the two
 * fallback wrappers `formatErrorForState` produces for un-typed throws: a raw
 * `Error` is wrapped as `InternalServerError` (HTTP 500) and any other value as
 * `AgentRuntimeError`. They must be refinable so persistence-layer throws
 * (`Failed query: …`) and state-store drops reach `matchErrorPattern` — without
 * them those land as a bare, un-classified 500.
 */
const REFINABLE_CODES = new Set<string>([
  AgentRuntimeErrorType.AgentRuntimeError,
  AgentRuntimeErrorType.ProviderBizError,
  String(ChatErrorType.InternalServerError),
]);

/**
 * Last-resort mapping from a bare HTTP status to a code, used only when the
 * message carried no recognizable pattern. Intentionally coarse: the rich
 * cases (quota keywords, moderation, model-not-found, …) are already handled by
 * `matchErrorPattern`, so this just buckets the context-less remainder by
 * status class.
 */
const codeFromHttpStatus = (status: number | undefined): ILobeAgentRuntimeErrorType | undefined => {
  if (!status) return undefined;
  // 429 / 402 have unambiguous semantics worth special-casing.
  if (status === 429) return AgentRuntimeErrorType.RateLimitExceeded;
  if (status === 402) return AgentRuntimeErrorType.InsufficientQuota;
  if (status >= 500 && status <= 599) return AgentRuntimeErrorType.ProviderServiceUnavailable;
  // Any other client error with no usable message → the bare-HTTP bucket.
  if (status >= 400 && status <= 499) return AgentRuntimeErrorType.UpstreamHttpError;
  return undefined;
};

/**
 * Runtime error messages are conventionally prefixed with the upstream HTTP
 * status (e.g. `"429 status code (no body)"`, `"503 Service temporarily
 * unavailable"`). Pull that leading status out as a fallback when the structured
 * status isn't available on the error object.
 */
const leadingStatusFromMessage = (message: string | undefined): number | undefined => {
  if (!message) return undefined;
  const match = /^\s*([45]\d{2})\b/.exec(message);
  return match ? Number(match[1]) : undefined;
};

export interface RefineErrorInput {
  /** The errorType the adapter assigned (only `ProviderBizError` is refined). */
  errorType?: string;
  /** Structured HTTP status from the upstream response, if known. */
  httpStatus?: number;
  message?: string;
  provider?: string;
}

/**
 * Reclassify a generic catch-all (`ProviderBizError`, or the
 * `InternalServerError` / `AgentRuntimeError` fallback wrappers) into a more
 * specific code using the message and HTTP status. Returns the refined code, or
 * `undefined` when no better classification is found (caller keeps the original
 * errorType).
 *
 * Priority:
 *   1. `matchErrorPattern` over the message — most specific, covers the rich
 *      cases plus the migrated `Upstream*` patterns.
 *   2. HTTP-status fallback for messages that matched nothing.
 */
export const refineErrorCode = (
  input: RefineErrorInput,
): ILobeAgentRuntimeErrorType | undefined => {
  const { errorType, httpStatus, message, provider } = input;
  if (!errorType || !REFINABLE_CODES.has(errorType)) return undefined;

  const matched = matchErrorPattern({ errorType, message, provider });
  if (matched && matched.code !== errorType) return matched.code;

  const byStatus = codeFromHttpStatus(httpStatus ?? leadingStatusFromMessage(message));
  if (byStatus && byStatus !== errorType) return byStatus;

  return undefined;
};
