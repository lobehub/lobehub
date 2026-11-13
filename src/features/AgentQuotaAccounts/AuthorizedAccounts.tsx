'use client';

import type { QuotaAccountProvider } from '@lobechat/types';
import { Button, Flexbox, Text, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import { AddAccountCard, LinkedAccountCard } from './AccountCard';
import { openAddAccountsModal } from './AddAccountsModal';
import { AGENT_QUOTA_ACCOUNTS_ANCHOR, scrollToAgentQuotaAccounts } from './anchor';
import { useAgentAuthorizedAccounts } from './useAgentAuthorizedAccounts';
import { useCanManageAccountPool } from './useCanManageAccountPool';

const styles = stylex.create({
  // The anchor sits under the card title, and the profile has a sticky header:
  // leave room for both so a jump lands with the title in view.
  anchor: { scrollMarginTop: '112px' },
  hint: { fontSize: '12px', color: cssVar.colorTextTertiary },
  // One card per pool account, as many per row as fit.
  grid: {
    display: 'grid',
    gap: '8px',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
  },
});

interface AuthorizedAccountsProps {
  agentId: string;
  disabled?: boolean;
  provider?: QuotaAccountProvider;
}

/**
 * The agent's "subscription accounts": the accounts of the global pool
 * (Settings → Subscription Accounts) this agent may be scheduled on, as cards.
 * More are added from the pool through a dialog, and each card can take its
 * authorization back. This is a scheduling permission, not ownership — any
 * number of agents can add the same account. The load balancer only ever
 * chooses among the accounts listed here.
 */
const AuthorizedAccounts = memo<AuthorizedAccountsProps>(({ agentId, disabled, provider }) => {
  const { t } = useTranslation('chat');
  const navigate = useWorkspaceAwareNavigate();
  const canManagePool = useCanManageAccountPool();
  const { hash } = useLocation();
  const { accounts, add, canEdit, linked, loadFailed, loaded, remove, retry, unlinked } =
    useAgentAuthorizedAccounts(agentId, provider);

  // Arriving from the load balancer's "add accounts" link: scroll here once
  // the list has its final height.
  useEffect(() => {
    if (loaded && hash === `#${AGENT_QUOTA_ACCOUNTS_ANCHOR}`) scrollToAgentQuotaAccounts();
  }, [hash, loaded]);

  const onRemove = async (accountId: string) => {
    if (!(await remove(accountId))) toast.error(t('heteroAgent.agentAccounts.saveFailed'));
  };
  const openSettings = () => navigate('/settings/subscription-accounts');

  return (
    <Flexbox
      className={stylex.props(styles.anchor).className}
      gap={8}
      id={AGENT_QUOTA_ACCOUNTS_ANCHOR}
    >
      <Text className={stylex.props(styles.hint).className}>
        {t('heteroAgent.agentAccounts.desc')}
      </Text>
      {loadFailed ? (
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
          <Text className={stylex.props(styles.hint).className}>
            {t('heteroAgent.agentAccounts.loadFailed')}
          </Text>
          <Button onClick={() => void retry()}>{t('heteroAgent.agentAccounts.retry')}</Button>
        </Flexbox>
      ) : !loaded ? null : accounts.length === 0 ? (
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
          <Text className={stylex.props(styles.hint).className}>
            {t('heteroAgent.agentAccounts.emptyPool')}
          </Text>
          {canManagePool ? (
            <Button onClick={openSettings}>{t('heteroAgent.agentAccounts.openSettings')}</Button>
          ) : (
            <Text className={stylex.props(styles.hint).className}>
              {t('heteroAgent.agentAccounts.askAdmin')}
            </Text>
          )}
        </Flexbox>
      ) : (
        <>
          {linked.length === 0 && (
            <Text className={stylex.props(styles.hint).className}>
              {t('heteroAgent.agentAccounts.noneLinked')}
            </Text>
          )}
          <div {...stylex.props(styles.grid)}>
            {linked.map((a) => (
              <LinkedAccountCard
                account={a}
                busy={!canEdit}
                key={a.id}
                removeLabel={t('heteroAgent.agentAccounts.remove')}
                onRemove={disabled ? undefined : () => void onRemove(a.id)}
              />
            ))}
            {!disabled && unlinked.length > 0 && (
              <AddAccountCard
                label={t('heteroAgent.agentAccounts.add')}
                onClick={() => {
                  if (canEdit) openAddAccountsModal({ candidates: unlinked, onAdd: add });
                }}
              />
            )}
          </div>
          {/* Every pool account is already here: more come from Settings. */}
          {unlinked.length === 0 && (
            <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
              <Text className={stylex.props(styles.hint).className}>
                {t('heteroAgent.agentAccounts.allSelected')}
              </Text>
              {canManagePool && (
                <Button size={'small'} style={{ flex: 'none' }} onClick={openSettings}>
                  {t('heteroAgent.agentAccounts.openSettings')}
                </Button>
              )}
            </Flexbox>
          )}
        </>
      )}
    </Flexbox>
  );
});

AuthorizedAccounts.displayName = 'AuthorizedAccounts';

export default AuthorizedAccounts;
