import type { ContactUserProfile } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { CircleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import ShareOwnerContactCard from '@/business/client/features/ShareOwnerContactCard';
import ShareTipAction from '@/business/client/features/ShareTipAction';

import { receiptErrorKey } from './MessageReceipts';
import { statusStyles, toneStyles } from './styles';

/**
 * Below a visitor's message whose reply a shared Agent's limit refused: why, the creator's card
 * when the limit is theirs to raise, and the way to tip the Agent when a tip lifts it. There is
 * no retry; the limit still holds.
 */
export function ShareRefusalNotice({
  errorType,
  owner,
  tipAgentId,
}: {
  errorType: string;
  owner?: ContactUserProfile;
  tipAgentId?: string;
}) {
  const { t } = useTranslation('channel');
  const reasonKey = receiptErrorKey(errorType);

  return (
    <Flexbox gap={6} {...stylex.props(statusStyles.receipts)}>
      <span {...stylex.props(statusStyles.state, toneStyles.error)}>
        <Icon icon={CircleAlert} size={12} />
        {reasonKey ? t(reasonKey) : t('receipt.errorUnavailable')}
      </span>
      {owner && <ShareOwnerContactCard owner={owner} />}
      {tipAgentId && <ShareTipAction agentId={tipAgentId} />}
    </Flexbox>
  );
}
