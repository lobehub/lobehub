import { isRemoteServerNetworkError } from '@lobechat/types';
import { t } from 'i18next';

/**
 * Build user-facing copy for a response body that parsed as JSON but was not a
 * `TRPCResponse`, so the tRPC client could not read it.
 *
 * The desktop backend proxy answers upstream network failures with its own
 * envelope (`{ errorType, body }`) which already carries a precise diagnosis —
 * reuse the same copy `remoteServerErrorToast` shows for it. Any other foreign
 * JSON (a gateway or WAF error page, an unexpected redirect payload) only gets
 * the generic "try again" message.
 */
export const unreadableResponseMessage = (responseJSON: unknown): string => {
  const errorType = (responseJSON as { errorType?: unknown } | null | undefined)?.errorType;

  return isRemoteServerNetworkError(errorType)
    ? t(`response.${errorType}`, { ns: 'error' })
    : t('response.UnreadableServerResponse', { ns: 'error' });
};
