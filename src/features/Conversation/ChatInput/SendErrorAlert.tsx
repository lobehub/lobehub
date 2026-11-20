import { ChatErrorType } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useBusinessSendErrorAlert } from '@/business/client/hooks/useBusinessSendErrorAlert';
import { NoticeAlert } from '@/components/NoticeAlert';

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
  const business = useBusinessSendErrorAlert(errorMessage, onClose);

  const isConcurrencyLimit = errorMessage === ChatErrorType.AgentConcurrencyLimitExceeded;
  const isRunFeeUnfunded = errorMessage === ChatErrorType.InsufficientBudgetForAgentRunFee;

  // `errorMessage` can still be a raw database dump on servers predating the
  // databaseError middleware. That text is SQL plus every bound parameter —
  // including the user's own input — so it is never echoed; generic copy
  // stands in for it.
  const title =
    business.title ??
    (isConcurrencyLimit
      ? t('input.concurrencyLimit.title')
      : isRunFeeUnfunded
        ? t('input.agentRunFeeUnfunded.title')
        : t('input.errorMsg', {
            errorMsg:
              toDisplayableSendErrorMessage(errorMessage) ?? t('unknownError', { ns: 'common' }),
          }));

  // The title says what stopped the send; the line under it says what to do.
  // As a single sentence the two overflowed the row and stranded a word on the
  // second line.
  const description =
    business.description ??
    (isConcurrencyLimit
      ? t('input.concurrencyLimit.desc')
      : isRunFeeUnfunded
        ? t('input.agentRunFeeUnfunded.desc')
        : undefined);

  // Same bottom gap and edges as the other notices above the composer, so two
  // of them stack at an even rhythm and line up with the input.
  return (
    <Flexbox paddingBlock={'0 8px'}>
      <NoticeAlert
        closable
        action={business.action}
        description={description}
        title={title}
        type={'secondary'}
        onClose={onClose}
      />
    </Flexbox>
  );
});

SendErrorAlert.displayName = 'SendErrorAlert';

export default SendErrorAlert;
