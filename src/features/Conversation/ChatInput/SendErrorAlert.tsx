import { ChatErrorType } from '@lobechat/types';
import { Alert, Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useBusinessSendErrorAlert } from '@/business/client/hooks/useBusinessSendErrorAlert';

import { toDisplayableSendErrorMessage } from './utils';

interface SendErrorAlertProps {
  /** The failed send's `error.message`. */
  errorMessage: string;
  onClose: () => void;
}

/**
 * Notice above the composer for a send the server refused. The typed message
 * is back in the composer, so the notice only says why and what to do next.
 */
const SendErrorAlert = memo<SendErrorAlertProps>(({ errorMessage, onClose }) => {
  const { t } = useTranslation(['chat', 'common']);
  const business = useBusinessSendErrorAlert(errorMessage);

  // `errorMessage` can still be a raw database dump on servers predating the
  // databaseError middleware. That text is SQL plus every bound parameter —
  // including the user's own input — so it is never echoed; generic copy
  // stands in for it.
  const title =
    business.title ??
    (errorMessage === ChatErrorType.AgentConcurrencyLimitExceeded
      ? t('input.concurrencyLimit')
      : t('input.errorMsg', {
          errorMsg:
            toDisplayableSendErrorMessage(errorMessage) ?? t('unknownError', { ns: 'common' }),
        }));

  return (
    <Flexbox paddingBlock={'0 6px'} paddingInline={12}>
      <Alert closable action={business.action} title={title} type={'secondary'} onClose={onClose} />
    </Flexbox>
  );
});

SendErrorAlert.displayName = 'SendErrorAlert';

export default SendErrorAlert;
