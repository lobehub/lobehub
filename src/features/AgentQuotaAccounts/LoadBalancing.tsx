'use client';

import { Button, Flexbox, Icon } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { PencilIcon, Trash2Icon } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { accountLoadOf } from './accountLoad';
import { AGENT_LOAD_BALANCING_ANCHOR, scrollToAgentLoadBalancing } from './anchor';
import { AutoBalanceCard, LoadAccountCard } from './LoadAccountCard';
import { AccountReadingsSync, ManagerFooter, ManagerNotices } from './QuotaAccountManagerParts';
import { accountName, AUTO, useQuotaAccountManager } from './useQuotaAccountManager';

const NOW_TICK_MS = 60_000;

const styles = stylex.create({
  anchor: { scrollMarginTop: '112px' },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))',
    gap: '8px',
  },
});

interface LoadBalancingProps {
  agentId: string;
  deviceId?: string;
  disabled?: boolean;
  onManageAccounts?: () => void;
}

/**
 * Agent profile → load balancing: Auto, or one account pinned, picked from
 * cards that show each authorized account's session and weekly headroom.
 */
const LoadBalancing = memo<LoadBalancingProps>(
  ({ agentId, deviceId, disabled, onManageAccounts }) => {
    const { t } = useTranslation('chat');
    const manager = useQuotaAccountManager({ agentId, deviceId, disabled });
    const {
      accounts,
      bindingOf,
      bindingsLoaded,
      busy,
      canEditBindings,
      editLabel,
      editingId,
      inRotation,
      loginPending,
      readingsMap,
      remove,
      routeAccount,
      saveEdit,
      selected,
      setEditLabel,
      setEditingId,
      setPending,
      signIn,
      signedInHere,
      startEdit,
    } = manager;
    // Ticks so reset countdowns and rolled-over windows stay current while the page is open.
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
      const timer = window.setInterval(() => setNow(Date.now()), NOW_TICK_MS);
      return () => window.clearInterval(timer);
    }, []);
    const autoChecked = bindingsLoaded && selected === AUTO;

    // Arriving from the chat bar's quota panel: scroll here once the cards are in.
    const { hash } = useLocation();
    useEffect(() => {
      if (bindingsLoaded && hash === `#${AGENT_LOAD_BALANCING_ANCHOR}`)
        scrollToAgentLoadBalancing();
    }, [bindingsLoaded, hash]);

    return (
      <Flexbox
        className={stylex.props(styles.anchor).className}
        gap={8}
        id={AGENT_LOAD_BALANCING_ANCHOR}
      >
        {accounts.map((a) => (
          <AccountReadingsSync accountId={a.id} key={a.id} />
        ))}
        <Flexbox gap={8} role={'radiogroup'}>
          <AutoBalanceCard
            checked={autoChecked}
            locked={busy || !canEditBindings}
            hint={
              autoChecked
                ? routeAccount
                  ? t('heteroAgent.claudeQuota.manage.autoRoutingTo', {
                      account: accountName(routeAccount),
                    })
                  : accounts.length === 0
                    ? t('heteroAgent.claudeQuota.manage.autoNoAuthorizedAccount')
                    : t('heteroAgent.claudeQuota.manage.autoNoSignedInAccount')
                : undefined
            }
            onSelect={() => setPending(AUTO)}
          />
          {accounts.length > 0 && (
            <div {...stylex.props(styles.grid)}>
              {accounts.map((a) => {
                const runnable = signedInHere(a);
                const isEditing = editingId === a.id;

                return (
                  <LoadAccountCard
                    account={a}
                    checked={bindingsLoaded && selected === a.id}
                    key={a.id}
                    load={accountLoadOf(readingsMap[a.id] ?? [], now)}
                    notSignedIn={!runnable}
                    routing={autoChecked && routeAccount?.id === a.id}
                    menuItems={
                      disabled
                        ? undefined
                        : [
                            {
                              icon: <Icon icon={PencilIcon} />,
                              key: 'edit',
                              label: t('heteroAgent.claudeQuota.manage.edit'),
                              onClick: () => startEdit(a),
                            },
                            { type: 'divider' as const },
                            {
                              danger: true,
                              disabled: !canEditBindings || !bindingOf(a.id),
                              icon: <Icon icon={Trash2Icon} />,
                              key: 'remove',
                              label: t('heteroAgent.agentAccounts.remove'),
                              onClick: () => void remove(a.id),
                            },
                          ]
                    }
                    signIn={
                      !runnable && !disabled ? (
                        <Button
                          disabled={loginPending}
                          size={'small'}
                          style={{ flex: 'none' }}
                          onClick={() => void signIn(a.email ?? undefined)}
                        >
                          {t('heteroAgent.claudeQuota.manage.signIn')}
                        </Button>
                      ) : undefined
                    }
                    onSelect={() => setPending(a.id)}
                    locked={busy || !canEditBindings || !inRotation(a.id) || !runnable || isEditing}
                    // Rename and remove both write: none in a read-only view.
                    editing={
                      isEditing
                        ? {
                            busy,
                            label: editLabel,
                            onCancel: () => setEditingId(null),
                            onChange: setEditLabel,
                            onSave: () => void saveEdit(a.id),
                          }
                        : undefined
                    }
                  />
                );
              })}
            </div>
          )}
        </Flexbox>
        <ManagerNotices manager={manager} onManageAccounts={onManageAccounts} />
        <ManagerFooter disabled={disabled} manager={manager} />
      </Flexbox>
    );
  },
);

LoadBalancing.displayName = 'LoadBalancing';

export default LoadBalancing;
