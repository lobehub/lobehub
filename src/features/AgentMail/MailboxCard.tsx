'use client';

import {
  ActionIcon,
  createModal,
  DropdownMenu,
  Flexbox,
  Icon,
  Skeleton,
  Tag,
  Text,
  toast,
} from '@lobehub/ui';
import { Check, ChevronsUpDown, Copy, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { AgentAccountView } from '@/services/agentAccount';
import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';

import AddMailboxForm from './AddMailboxForm';
import { IDENTITY_CHANNELS, isChannelAccount, KIND_ICONS } from './const';
import InlineError from './InlineError';
import ProvisionCard from './ProvisionCard';
import { identityStyles } from './styles';
import type { Mailbox } from './useAgentIdentity';
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

const channelOf = (account: AgentAccountView) =>
  IDENTITY_CHANNELS.find((channel) => isChannelAccount(account, channel));

interface MailboxCardProps {
  agentId: string;
  /** Read-only viewer: mailboxes stay readable, nothing can be added or released. */
  disabled?: boolean;
  mailbox: Mailbox;
  onSwitch: (accountId: string) => void;
}

/**
 * The mailbox being read: one card that switches between the agent's addresses
 * and keeps what is done to an address behind its menu.
 *
 * An agent with no address gets the offer to open one instead, because opening
 * is an explicit act and the absence should be visible.
 */
const MailboxCard = memo<MailboxCardProps>(({ agentId, disabled, mailbox, onSwitch }) => {
  const { t } = useTranslation(['setting', 'common']);
  const { accounts, current, data, error, isLoading, mutate } = mailbox;
  const providers = useServerConfigStore(serverConfigSelectors.agentIdentityProviders);
  const { release } = useAccountActions({
    agentId,
    onChanged: () => {
      // The open message belonged to the released mailbox, so move off it too.
      const next = accounts.find((account) => account.id !== current?.id);
      if (next) onSwitch(next.id);
      return mutate();
    },
  });

  // An offer this deployment cannot fulfil would only fail on click.
  const openable = IDENTITY_CHANNELS.find((channel) => providers.includes(channel.provider));

  // Only a read that never succeeded replaces the card. A later revalidation
  // that fails keeps the mailbox on screen, with the failure beside it.
  const failure = error ? (
    <InlineError
      detail={error instanceof Error ? error.message : String(error)}
      summary={t('identity.loadFailed')}
      onRetry={() => void mutate()}
    />
  ) : undefined;

  if (error && !data) return failure;
  if (isLoading && !data) return <Skeleton height={56} width={'100%'} />;

  if (!current) {
    if (!openable) return failure ?? null;

    return (
      <ProvisionCard
        agentId={agentId}
        channel={openable}
        disabled={disabled}
        onProvisioned={mutate}
      />
    );
  }

  const channel = channelOf(current);

  const openAdd = () => {
    if (!openable) return;
    const modal = createModal({
      content: (
        <AddMailboxForm
          agentId={agentId}
          channel={openable}
          onAdded={(account) => {
            onSwitch(account.id);
            modal.close();
          }}
          onChanged={mutate}
        />
      ),
      footer: null,
      maskClosable: true,
      title: t('identity.add'),
      width: 400,
    });
  };

  const switchItems = [
    ...accounts.map((account) => ({
      icon:
        account.id === current.id ? Check : (channelOf(account)?.icon ?? KIND_ICONS[account.kind]),
      key: account.id,
      label: account.identifier,
      onClick: () => onSwitch(account.id),
    })),
    ...(openable && !disabled
      ? [
          { type: 'divider' as const },
          { icon: Plus, key: 'add', label: t('identity.add'), onClick: openAdd },
        ]
      : []),
  ];

  const moreItems = [
    {
      icon: Copy,
      key: 'copy',
      label: t('identity.copy'),
      onClick: async () => {
        await navigator.clipboard.writeText(current.identifier);
        toast.success(t('copySuccess', { ns: 'common' }));
      },
    },
    {
      danger: true,
      disabled,
      icon: Trash2,
      key: 'release',
      label: t('identity.release'),
      onClick: () => void release(current),
    },
  ];

  return (
    <Flexbox gap={8}>
      <Flexbox horizontal align={'center'} className={identityStyles.card} gap={4}>
        <DropdownMenu items={switchItems}>
          <div
            aria-label={t('identity.switch')}
            className={identityStyles.mailboxTrigger}
            role={'button'}
            tabIndex={0}
          >
            <Icon
              className={identityStyles.icon}
              icon={channel?.icon ?? KIND_ICONS[current.kind]}
              size={18}
            />
            <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
              <Text code ellipsis weight={500}>
                {current.identifier}
              </Text>
              <Flexbox horizontal align={'center'} gap={8}>
                <Text ellipsis fontSize={12} style={{ minWidth: 0 }} type={'secondary'}>
                  {current.displayName || (channel ? t(channel.titleKey) : current.provider)}
                </Text>
                <Tag style={{ flexShrink: 0 }}>{t(STATUS_KEYS[current.status])}</Tag>
              </Flexbox>
            </Flexbox>
            <Icon className={identityStyles.icon} icon={ChevronsUpDown} size={14} />
          </div>
        </DropdownMenu>
        <DropdownMenu items={moreItems}>
          <ActionIcon icon={MoreHorizontal} size={'small'} title={t('identity.more')} />
        </DropdownMenu>
      </Flexbox>
      {failure}
    </Flexbox>
  );
});

MailboxCard.displayName = 'AgentMailboxCard';

export default MailboxCard;
