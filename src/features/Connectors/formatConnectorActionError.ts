import { type TFunction } from 'i18next';

import { type ConnectorActionError } from '@/utils/connectorActionError';

/**
 * Localized, in-row explanation of a failed connector write. A permission
 * rejection, a dropped request and an abandoned OAuth window get plain wording.
 * A `BAD_REQUEST` carries a reason the user can act on (e.g. an OAuth server
 * that rejects registration), so its message is shown as-is; any other failure
 * gets a generic reason instead of raw upstream output.
 */
export const formatConnectorActionError = (
  t: TFunction<'setting'>,
  error: ConnectorActionError,
  name: string,
): string => {
  let reason: string;
  switch (error.code) {
    case 'FORBIDDEN': {
      reason = t('tools.connectorFeedback.reason.forbidden');
      break;
    }
    case 'NETWORK': {
      reason = t('tools.connectorFeedback.reason.network');
      break;
    }
    case 'AUTH_INCOMPLETE': {
      reason = t('tools.connectorFeedback.reason.authIncomplete', { name });
      break;
    }
    case 'BAD_REQUEST': {
      reason = error.message || t('tools.connectorFeedback.reason.unknown');
      break;
    }
    default: {
      reason = t('tools.connectorFeedback.reason.unknown');
    }
  }

  if (error.action === 'connect') return t('tools.connectorFeedback.connectFailed', { reason });

  // A permission rejection will fail again, so do not invite a retry.
  return error.code === 'FORBIDDEN'
    ? t('tools.connectorFeedback.removeFailedFinal', { reason })
    : t('tools.connectorFeedback.removeFailed', { reason });
};
