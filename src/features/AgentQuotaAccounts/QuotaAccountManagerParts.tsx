'use client';

import { Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { t as i18nT } from 'i18next';
import { PlusIcon, UsersIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentQuotaStore } from '@/store/agentQuota';

import { type useQuotaAccountManager } from './useQuotaAccountManager';

const styles = stylex.create({
  footer: {
    marginBlockStart: '4px',
    paddingBlockStart: '10px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  hint: { fontSize: '12px', color: cssVar.colorTextTertiary },
  poolHint: {
    marginBlockStart: '6px',
    paddingBlock: '8px',
    paddingInline: '10px',
    borderRadius: cssVar.borderRadius,
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillTertiary,
  },
});

type Manager = ReturnType<typeof useQuotaAccountManager>;

/** Keeps one account's newest readings in sync while it is listed. */
export const AccountReadingsSync = memo<{ accountId: string }>(({ accountId }) => {
  const useFetchQuotaReadings = useAgentQuotaStore((s) => s.useFetchQuotaReadings);
  useFetchQuotaReadings(accountId);
  return null;
});

AccountReadingsSync.displayName = 'AccountReadingsSync';

interface ManagerNoticesProps {
  manager: Manager;
  onManageAccounts?: () => void;
}

/** "No accounts yet", and the hint that one account is no pool to balance across. */
export const ManagerNotices = memo<ManagerNoticesProps>(({ manager, onManageAccounts }) => {
  const { t } = useTranslation('chat');
  const { accounts, accountsConfirmed, accountsError, bindingsLoaded, claudeAccounts } = manager;

  return (
    <>
      {claudeAccounts.length === 0 && (accountsConfirmed || !!accountsError) && (
        <Text className={stylex.props(styles.hint).className}>
          {t('heteroAgent.claudeQuota.manage.empty')}
        </Text>
      )}

      {/* One account is no pool to balance across: point at where more are added. */}
      {bindingsLoaded && claudeAccounts.length > 0 && accounts.length <= 1 && (
        <Flexbox
          horizontal
          align={'center'}
          className={stylex.props(styles.poolHint).className}
          data-testid={'quota-pool-hint'}
          gap={8}
          justify={'space-between'}
        >
          <Flexbox horizontal align={'center'} gap={6} style={{ minWidth: 0 }}>
            <Icon icon={UsersIcon} size={14} style={{ flex: 'none' }} />
            <span>
              {accounts.length === 0
                ? t('heteroAgent.claudeQuota.manage.poolEmptyHint')
                : t('heteroAgent.claudeQuota.manage.poolSingleHint')}
            </span>
          </Flexbox>
          {onManageAccounts && (
            <Button size={'small'} style={{ flex: 'none' }} onClick={onManageAccounts}>
              {t('heteroAgent.claudeQuota.manage.addAccounts')}
            </Button>
          )}
        </Flexbox>
      )}
    </>
  );
});

ManagerNotices.displayName = 'ManagerNotices';

/** Confirm a staged switch, or sign in another local login on the desktop. */
export const ManagerFooter = memo<{ disabled?: boolean; manager: Manager }>(
  ({ disabled, manager }) => {
    const { t } = useTranslation('chat');
    const {
      applySelection,
      busy,
      cancelSignIn,
      dirty,
      loginPending,
      managesLocalLogins,
      setPending,
      signIn,
    } = manager;

    if (dirty)
      return (
        <Flexbox
          horizontal
          className={stylex.props(styles.footer).className}
          gap={8}
          justify={'flex-end'}
        >
          <Button disabled={busy} onClick={() => setPending(null)}>
            {i18nT('cancel', { ns: 'common' })}
          </Button>
          <Button loading={busy} type={'primary'} onClick={() => void applySelection()}>
            {t('heteroAgent.claudeQuota.manage.confirmSwitch')}
          </Button>
        </Flexbox>
      );

    if (managesLocalLogins && !disabled)
      return (
        <Flexbox
          horizontal
          align={'center'}
          className={stylex.props(styles.footer).className}
          gap={8}
          justify={'space-between'}
        >
          <Text className={stylex.props(styles.hint).className}>
            {loginPending
              ? t('heteroAgent.claudeQuota.manage.loginWaiting')
              : t('heteroAgent.claudeQuota.manage.addHintDesktop')}
          </Text>
          {loginPending ? (
            <Button size={'small'} style={{ flex: 'none' }} onClick={cancelSignIn}>
              {i18nT('cancel', { ns: 'common' })}
            </Button>
          ) : (
            <Button
              icon={PlusIcon}
              size={'small'}
              style={{ flex: 'none' }}
              onClick={() => void signIn()}
            >
              {t('heteroAgent.claudeQuota.manage.add')}
            </Button>
          )}
        </Flexbox>
      );

    return (
      <Text className={stylex.props(styles.hint).className} style={{ marginBlockStart: 4 }}>
        {t('heteroAgent.claudeQuota.manage.addHint')}
      </Text>
    );
  },
);

ManagerFooter.displayName = 'ManagerFooter';
