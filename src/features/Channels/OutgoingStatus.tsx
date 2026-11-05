import { Button, Icon } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { CircleAlert, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { channelActions, type ChannelOutgoingMessage } from '@/store/channel';

import { statusStyles, styles, toneStyles } from './styles';

/** Below a message this tab sent: sending, or failed with retry and delete. */
export function OutgoingStatus({
  message,
  onRetry,
}: {
  message: ChannelOutgoingMessage;
  /** Sends the failed message again; the conversation follows where it lands. */
  onRetry: (message: ChannelOutgoingMessage) => void;
}) {
  const { t } = useTranslation('channel');
  if (message.status === 'sent') return null;
  if (message.status === 'sending')
    return (
      <span
        role="status"
        {...stylex.props(statusStyles.receipts, statusStyles.state, styles.muted)}
      >
        <Icon spin icon={Loader2} size={12} />
        {t('outgoing.sending')}
      </span>
    );
  return (
    <span role="alert" {...stylex.props(statusStyles.receipts, statusStyles.state)}>
      <span {...stylex.props(statusStyles.state, toneStyles.error)}>
        <Icon icon={CircleAlert} size={12} />
        {t('outgoing.failed')}
      </span>
      <Button size="small" type="text" onClick={() => onRetry(message)}>
        {t('outgoing.retry')}
      </Button>
      <Button size="small" type="text" onClick={() => channelActions.discardSend(message)}>
        {t('outgoing.discard')}
      </Button>
    </span>
  );
}
