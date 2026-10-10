'use client';

import { CopyButton, Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon, Tag, Text } from '@lobehub/ui/base-ui';
import { Trash2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { AgentAccountView } from '@/services/agentAccount';

import type { IdentityChannel } from './const';
import { KIND_ICONS } from './const';
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
  /**
   * The built-in channel the account belongs to. Absent for a mounted account
   * (e.g. provider `user`); the card then falls back to the account's kind and
   * provider so the address can still be read, copied and released.
   */
  channel?: IdentityChannel;
  /** Read-only viewer: the address stays copyable, but cannot be released. */
  disabled?: boolean;
  onChanged: () => Promise<unknown> | void;
}

/**
 * One owned address: what it is, whether it is live, and the two things a
 * person does with it — copy it out, or give it back.
 */
const AccountCard = memo<AccountCardProps>(({ account, channel, agentId, disabled, onChanged }) => {
  const { t } = useTranslation('setting');
  const { release } = useAccountActions({ agentId, onChanged });

  return (
    <Flexbox horizontal align={'center'} className={identityStyles.card} gap={12}>
      <Icon
        className={identityStyles.icon}
        icon={channel?.icon ?? KIND_ICONS[account.kind]}
        size={18}
      />
      <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Text code ellipsis weight={500}>
            {account.identifier}
          </Text>
          <Tag>{t(STATUS_KEYS[account.status])}</Tag>
        </Flexbox>
        <Text fontSize={12} type={'secondary'}>
          {account.displayName || (channel ? t(channel.titleKey) : account.provider)}
        </Text>
      </Flexbox>
      <CopyButton content={account.identifier} title={t('identity.copy')} />
      <ActionIcon
        disabled={disabled}
        icon={Trash2}
        title={t('identity.release')}
        onClick={() => {
          if (disabled) return;
          void release(account);
        }}
      />
    </Flexbox>
  );
});

AccountCard.displayName = 'AgentIdentityAccountCard';

export default AccountCard;
