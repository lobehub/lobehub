import { AgentRuntimeErrorType } from '@lobechat/types';

import type { ILobeAgentRuntimeErrorType } from '../../types/error';

/**
 * Voyage AI answers every failure with `{"detail": "<message>"}` (validation failures from
 * the request validator may also carry a list under `detail`).
 * @see https://docs.voyageai.com/docs/error-codes
 */
export interface VoyageErrorBody {
  detail?: unknown;
}

const HTTP_ERROR_TYPES: Record<number, ILobeAgentRuntimeErrorType> = {
  400: AgentRuntimeErrorType.InvalidRequestFormat,
  401: AgentRuntimeErrorType.InvalidProviderAPIKey,
  403: AgentRuntimeErrorType.PermissionDenied,
  413: AgentRuntimeErrorType.RequestBodyTooLarge,
  422: AgentRuntimeErrorType.InvalidRequestFormat,
  429: AgentRuntimeErrorType.RateLimitExceeded,
  503: AgentRuntimeErrorType.ProviderServiceUnavailable,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Message of a Voyage error body. Accepts the documented `{detail: string}` and the
 * request validator's `{detail: [{msg}]}` list; anything else is reported as unreadable
 * instead of being stringified, so no unrelated payload is echoed back.
 */
export const extractVoyageErrorDetail = (body: unknown): string | undefined => {
  if (!isRecord(body)) return;

  const { detail } = body as VoyageErrorBody;

  if (typeof detail === 'string') return detail.trim() || undefined;

  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => (isRecord(item) && typeof item.msg === 'string' ? item.msg : undefined))
      .filter((message): message is string => !!message);

    return messages.length > 0 ? messages.join('; ') : undefined;
  }
};

export const resolveVoyageErrorType = (statusCode?: number): ILobeAgentRuntimeErrorType =>
  (statusCode !== undefined && HTTP_ERROR_TYPES[statusCode]) ||
  AgentRuntimeErrorType.ProviderBizError;
