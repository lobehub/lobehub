'use client';

import { displayPlanTier } from '@lobechat/heterogeneous-agents/quota';
import type { QuotaAccountProvider } from '@lobechat/types';
import { Button, Checkbox, Flexbox, Text, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { type QuotaAccount } from '@/store/agentQuota';

import { AGENT_QUOTA_ACCOUNTS_ANCHOR, scrollToAgentQuotaAccounts } from './anchor';
import { useAgentAuthorizedAccounts } from './useAgentAuthorizedAccounts';
import { useCanManageAccountPool } from './useCanManageAccountPool';

const styles = stylex.create({
  // The anchor sits under the card title, and the profile has a sticky header:
  // leave room for both so a jump lands with the title in view.
  anchor: { scrollMarginTop: '112px' },
  hint: { fontSize: '12px', color: cssVar.colorTextTertiary },
  row: {
    paddingBlock: '6px',
    paddingInline: '8px',
    borderRadius: cssVar.borderRadius,
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
  },
});

const accountName = (a: QuotaAccount) => a.label || a.email || a.externalAccountId;

interface AuthorizedAccountsProps {
  agentId: string;
  disabled?: boolean;
  provider?: QuotaAccountProvider;
}

/**
 * Agent Profile "subscription accounts": pick which accounts of the global pool
 * (Settings → Subscription Accounts) this agent may be scheduled on. This is a
 * scheduling permission, not ownership — any number of agents can pick the same
 * account. The load balancer only ever chooses among the accounts checked here.
 */
const AuthorizedAccounts = memo<AuthorizedAccountsProps>(({ agentId, disabled, provider }) => {
  const { t } = useTranslation('chat');
  const navigate = useWorkspaceAwareNavigate();
  const canManagePool = useCanManageAccountPool();
  const { hash } = useLocation();
  const { accounts, authorized, canEdit, loadFailed, loaded, retry, toggle } =
    useAgentAuthorizedAccounts(agentId, provider);

  // Arriving from the load balancer's "add accounts" link: scroll here once
  // the list has its final height.
  useEffect(() => {
    if (loaded && hash === `#${AGENT_QUOTA_ACCOUNTS_ANCHOR}`) scrollToAgentQuotaAccounts();
  }, [hash, loaded]);

  const onToggle = async (accountId: string, checked: boolean) => {
    if (!(await toggle(accountId, checked))) toast.error(t('heteroAgent.agentAccounts.saveFailed'));
  };

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
      ) : loaded && accounts.length === 0 ? (
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
          <Text className={stylex.props(styles.hint).className}>
            {t('heteroAgent.agentAccounts.emptyPool')}
          </Text>
          {canManagePool ? (
            <Button onClick={() => navigate('/settings/subscription-accounts')}>
              {t('heteroAgent.agentAccounts.openSettings')}
            </Button>
          ) : (
            <Text className={stylex.props(styles.hint).className}>
              {t('heteroAgent.agentAccounts.askAdmin')}
            </Text>
          )}
        </Flexbox>
      ) : (
        <Flexbox gap={2}>
          {accounts.map((a) => (
            <Checkbox
              checked={authorized.has(a.id)}
              className={stylex.props(styles.row).className}
              disabled={disabled || !canEdit}
              key={a.id}
              onChange={(checked) => void onToggle(a.id, checked)}
            >
              <Flexbox horizontal align={'center'} gap={6} style={{ minWidth: 0 }}>
                <Text ellipsis style={{ fontSize: 13 }}>
                  {accountName(a)}
                </Text>
                {a.planTier && (
                  <Text style={{ flex: 'none', fontSize: 12 }} type={'secondary'}>
                    {displayPlanTier(a)}
                  </Text>
                )}
              </Flexbox>
            </Checkbox>
          ))}
        </Flexbox>
      )}
      {loaded && accounts.length > 0 && (
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
          <Text className={stylex.props(styles.hint).className}>
            {authorized.size === accounts.length
              ? t('heteroAgent.agentAccounts.allSelected')
              : t('heteroAgent.agentAccounts.selected', {
                  count: authorized.size,
                  total: accounts.length,
                })}
          </Text>
          {/* Every pool account is already here: more come from Settings. */}
          {authorized.size === accounts.length && canManagePool && (
            <Button
              size={'small'}
              style={{ flex: 'none' }}
              onClick={() => navigate('/settings/subscription-accounts')}
            >
              {t('heteroAgent.agentAccounts.openSettings')}
            </Button>
          )}
        </Flexbox>
      )}
    </Flexbox>
  );
});

AuthorizedAccounts.displayName = 'AuthorizedAccounts';

export default AuthorizedAccounts;
