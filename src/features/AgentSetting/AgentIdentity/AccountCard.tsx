'use client';

import { CopyButton, Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon, Tag, Text } from '@lobehub/ui/base-ui';
import { Trash2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { AgentAccountView } from '@/services/agentAccount';

import type { IdentityChannel } from './const';
import { identityStyles } from './styles';
import { useAccountActions } from './useIdentityActions';

/**
 * Every lifecycle state gets a label, released included: the list filters
 * revoked accounts out today, but a tag that silently renders nothing would
 * turn a future filter change into a blank chip rather than a wrong-looking one.
 */
const STATUS_KEYS = {
  active: 'identity.status.active',
  provisioning: 'identity.status.provisioning',
  revoked: 'identity.status.revoked',
  suspended: 'identity.status.suspended',
} as const satisfies Record<AgentAccountView['status'], string>;

interface AccountCardProps {
  account: AgentAccountView;
  agentId: string;
  channel: IdentityChannel;
  onChanged: () => Promise<unknown> | void;
}

/**
 * One owned address: what it is, whether it is live, and the two things a
 * person does with it — copy it out, or give it back.
 */
const AccountCard = memo<AccountCardProps>(({ account, channel, agentId, onChanged }) => {
  const { t } = useTranslation('setting');
  const { release } = useAccountActions({ agentId, onChanged });

  return (
    <Flexbox horizontal align={'center'} className={identityStyles.card} gap={12}>
      <Icon className={identityStyles.icon} icon={channel.icon} size={18} />
      <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Text code ellipsis weight={500}>
            {account.identifier}
          </Text>
          <Tag>{t(STATUS_KEYS[account.status])}</Tag>
        </Flexbox>
        <Text fontSize={12} type={'secondary'}>
          {account.displayName || t(channel.titleKey)}
        </Text>
      </Flexbox>
      <CopyButton content={account.identifier} title={t('identity.copy')} />
      <ActionIcon
        icon={Trash2}
        title={t('identity.release')}
        onClick={() => {
          void release(account);
        }}
      />
    </Flexbox>
  );
});

AccountCard.displayName = 'AgentIdentityAccountCard';

export default AccountCard;
