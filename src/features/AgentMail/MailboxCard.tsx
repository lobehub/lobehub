'use client';

import {
  ActionIcon,
  createModal,
  DropdownMenu,
  Empty,
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

import AddMailboxForm from './AddMailboxForm';
import { IDENTITY_CHANNELS, isChannelAccount, KIND_ICONS } from './const';
import InlineError from './InlineError';
import { identityStyles } from './styles';
import { type Mailbox, useOpenableChannel } from './useAgentIdentity';
import { useAccountActions } from './useIdentityActions';

/**
 * Only a state that differs from the working default is worth a label. Released
 * is included: the list filters revoked accounts out today, but a tag that
 * silently renders nothing would turn a future filter change into a blank chip
 * rather than a wrong-looking one.
 */
const STATUS_KEYS = {
  provisioning: 'identity.status.provisioning',
  revoked: 'identity.status.revoked',
  suspended: 'identity.status.suspended',
} as const satisfies Record<Exclude<AgentAccountView['status'], 'active'>, string>;

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
 */
const MailboxCard = memo<MailboxCardProps>(({ agentId, disabled, mailbox, onSwitch }) => {
  const { t } = useTranslation(['setting', 'common']);
  const { accounts, current, data, error, isLoading, mutate } = mailbox;
  const openable = useOpenableChannel();
  const { release } = useAccountActions({
    agentId,
    onChanged: () => {
      // The open message belonged to the released mailbox, so move off it too.
      const next = accounts.find((account) => account.id !== current?.id);
      if (next) onSwitch(next.id);
      return mutate();
    },
  });

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
  if (isLoading && !data) return <Skeleton height={44} width={'100%'} />;

  const openAdd = () => {
    if (!openable) return;
    const modal = createModal({
      content: (
        <AddMailboxForm
          agentId={agentId}
          channel={openable}
          onChanged={mutate}
          onAdded={(account) => {
            onSwitch(account.id);
            modal.close();
          }}
        />
      ),
      footer: null,
      maskClosable: true,
      title: t('identity.add'),
      width: 400,
    });
  };

  // Mail kept from a released address is still listed below; offer a new
  // address beside it instead of hiding that mail behind the full-page offer.
  if (!current) {
    if (failure || !openable || disabled) return failure ?? null;

    return <Empty title={t('identity.empty.open')} variant={'dashed'} onClick={openAdd} />;
  }

  const channel = channelOf(current);

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
            <Text code ellipsis style={{ flex: 1, minWidth: 0 }} weight={500}>
              {current.identifier}
            </Text>
            {current.status !== 'active' && (
              <Tag style={{ flexShrink: 0 }}>{t(STATUS_KEYS[current.status])}</Tag>
            )}
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
