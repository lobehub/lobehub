import { type TFunction } from 'i18next';

import { getConnectorActionErrorCode } from '@/utils/connectorActionError';
import { ConnectorOAuthError } from '@/utils/connectorOAuth';

/** The user closed the authorization window themselves: nothing failed, so nothing to report. */
export const isDismissedAuthorization = (error: unknown): boolean =>
  error instanceof ConnectorOAuthError && error.reason === 'dismissed';

/**
 * A 403 means the cached manage policy was stale. The caller refetches it so
 * the controls turn disabled with their reason, instead of reporting an error
 * for a button that looked usable.
 */
export const isPermissionRejection = (error: unknown): boolean =>
  (error as { data?: { httpStatus?: number } } | undefined)?.data?.httpStatus === 403;

/**
 * Why an account action failed, as one sentence that ends with what to do
 * next. Callers put it after a lead naming the action and the account.
 */
export const formatAccountErrorReason = (t: TFunction<'tool'>, error: unknown): string => {
  if (error instanceof ConnectorOAuthError) {
    switch (error.reason) {
      case 'blocked': {
        return t('dev.oauthError.blocked', { ns: 'plugin' });
      }
      case 'timeout': {
        return t('connector.account.error.timeout');
      }
      default: {
        return t('connector.account.error.authFailed');
      }
    }
  }

  const code = getConnectorActionErrorCode(error);
  if (code === 'NETWORK') return t('connector.error.network');
  // A BAD_REQUEST carries a reason the user can act on (e.g. an OAuth server
  // that rejects the registration), so it is shown as the server worded it.
  if (code === 'BAD_REQUEST' && error instanceof Error && error.message) return error.message;

  return t('connector.account.error.retry');
};
