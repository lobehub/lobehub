import { isRemoteServerNetworkError } from '@lobechat/types';
import { t } from 'i18next';

export interface UnreadableResponseDetail {
  requestId?: string;
  status: number;
}

/**
 * Append the HTTP status and the edge request id of a non-JSON response, so a
 * user report (often a screenshot of this text) can be traced in the
 * gateway/CDN logs.
 */
export const withResponseDetail = (
  message: string,
  { requestId, status }: UnreadableResponseDetail,
): string =>
  requestId
    ? t('response.withRequestDetail', { message, ns: 'error', requestId, status })
    : t('response.withStatusDetail', { message, ns: 'error', status });

/**
 * Build user-facing copy for a response body that parsed as JSON but was not a
 * `TRPCResponse`, so the tRPC client could not read it.
 *
 * The desktop backend proxy answers upstream network failures with its own
 * envelope (`{ errorType, body }`) which already carries a precise diagnosis —
 * reuse the same copy `remoteServerErrorToast` shows for it. Any other foreign
 * JSON (a gateway or WAF error page, an unexpected redirect payload) only gets
 * the generic "try again" message. A body that was not JSON at all (an HTML
 * gateway page) also gets the generic copy, plus its status and request id.
 */
export const unreadableResponseMessage = (
  responseJSON: unknown,
  response?: UnreadableResponseDetail,
): string => {
  const errorType = (responseJSON as { errorType?: unknown } | null | undefined)?.errorType;

  if (isRemoteServerNetworkError(errorType)) return t(`response.${errorType}`, { ns: 'error' });

  const message = t('response.UnreadableServerResponse', { ns: 'error' });
  return response ? withResponseDetail(message, response) : message;
};
