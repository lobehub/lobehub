'use client';

import { Button, createModal, Flexbox, Text, toast, useModalContext } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { t as translate } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type QuotaAccount } from '@/store/agentQuota';

import { SelectableAccountCard } from './AccountCard';

const styles = stylex.create({
  grid: {
    display: 'grid',
    gap: '8px',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    maxHeight: '56vh',
    overflowY: 'auto',
  },
});

interface AddAccountsProps {
  /** Pool accounts this agent is not authorized for yet. */
  candidates: QuotaAccount[];
  /** Authorizes the picked accounts; resolves false when the server refused. */
  onAdd: (accountIds: string[]) => Promise<boolean>;
}

const AddAccounts = ({ candidates, onAdd }: AddAccountsProps) => {
  const { t } = useTranslation(['chat', 'common']);
  const { close } = useModalContext();
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [saving, setSaving] = useState(false);

  const pick = (accountId: string, checked: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (checked) next.add(accountId);
      else next.delete(accountId);
      return next;
    });

  const submit = async () => {
    setSaving(true);
    // Keep the pool order, not the click order.
    const ok = await onAdd(candidates.filter((a) => picked.has(a.id)).map((a) => a.id));
    setSaving(false);
    if (ok) close();
    else toast.error(t('heteroAgent.agentAccounts.saveFailed'));
  };

  return (
    <Flexbox gap={16}>
      <Text type={'secondary'}>{t('heteroAgent.agentAccounts.addDesc')}</Text>
      <div {...stylex.props(styles.grid)} role={'group'}>
        {candidates.map((a) => (
          <SelectableAccountCard
            account={a}
            checked={picked.has(a.id)}
            disabled={saving}
            key={a.id}
            onToggle={(checked) => pick(a.id, checked)}
          />
        ))}
      </div>
      <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
        <Text fontSize={12} type={'secondary'}>
          {t('heteroAgent.agentAccounts.selected', {
            count: picked.size,
            total: candidates.length,
          })}
        </Text>
        <Flexbox horizontal gap={8}>
          <Button disabled={saving} onClick={close}>
            {t('cancel', { ns: 'common' })}
          </Button>
          <Button
            disabled={picked.size === 0}
            loading={saving}
            type={'primary'}
            onClick={() => void submit()}
          >
            {t('heteroAgent.agentAccounts.addConfirm')}
          </Button>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
};

/** Picks accounts from the pool to authorize for this agent, several at once. */
export const openAddAccountsModal = (props: AddAccountsProps) =>
  createModal({
    content: <AddAccounts {...props} />,
    footer: null,
    maskClosable: true,
    styles: { content: { paddingBlock: 16, paddingInline: 24 } },
    title: translate('heteroAgent.agentAccounts.addTitle', { ns: 'chat' }),
    width: 'min(90vw, 720px)',
  });
