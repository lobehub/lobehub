'use client';

import { ActionIcon, Button, Empty, Flexbox, SearchBar, Select, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { RefreshCwIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import SkeletonBar from '@/components/Skeleton/Bar';
import { cacheScope } from '@/libs/replica';
import { agentQuotaSelectors, type QuotaAccount, useAgentQuotaStore } from '@/store/agentQuota';

import AccountDetailPanel from './AccountDetailPanel';
import AccountRow, { AccountListHeader, LIST_MIN_WIDTH, PROVIDER_NAME } from './AccountRow';
import {
  isSubscriptionProvider,
  matchesKeyword,
  sortAccounts,
  SUBSCRIPTION_PROVIDERS,
  type SubscriptionProvider,
} from './accountView';

type ProviderAccount = QuotaAccount & { provider: SubscriptionProvider };

const ALL = 'all';

/**
 * Every coding-agent subscription the workspace's devices have reported, as a
 * list with their live quota — the shared capacity agents are balanced onto.
 * Accounts register themselves when a CLI login reports quota; this page only
 * decides which of them stay in rotation and what they are called.
 */
const SubscriptionAccounts = () => {
  const { t } = useTranslation('setting');
  const useFetchQuotaAccounts = useAgentQuotaStore((s) => s.useFetchQuotaAccounts);
  const readQuotaReadings = useAgentQuotaStore((s) => s.readQuotaReadings);
  const { error, isValidating, revalidate } = useFetchQuotaAccounts();
  const [refreshing, setRefreshing] = useState(false);
  const scope = cacheScope.use();
  const confirmed = useAgentQuotaStore(agentQuotaSelectors.isAccountsConfirmed(scope));
  const loaded = useAgentQuotaStore(agentQuotaSelectors.accounts);
  const [provider, setProvider] = useState<SubscriptionProvider | typeof ALL>(ALL);
  const [keyword, setKeyword] = useState('');
  const [openId, setOpenId] = useState<string>();

  const accounts = sortAccounts(
    (loaded ?? []).filter((a): a is ProviderAccount => isSubscriptionProvider(a.provider)),
  );
  const present = SUBSCRIPTION_PROVIDERS.filter((p) => accounts.some((a) => a.provider === p));
  // A provider filter that no longer has accounts falls back to everything.
  const active = provider !== ALL && present.includes(provider) ? provider : ALL;
  const visible = accounts.filter(
    (a) => (active === ALL || a.provider === active) && matchesKeyword(a, keyword),
  );
  const openAccount = accounts.find((a) => a.id === openId);
  const inRotation = accounts.filter((a) => a.enabled !== false).length;

  // The meters read each account's own readings, which the list sync does not
  // touch: refreshing re-reads them too, or a newer sample would never show.
  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled([
        revalidate(),
        ...accounts.map((account) => readQuotaReadings(account.id, { fresh: true })),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  // A hydrated empty list may be stale: only the server's answer settles "none yet".
  const settling = !confirmed && !error && accounts.length === 0;

  const body = settling ? (
    <Flexbox gap={4}>
      {Array.from({ length: 5 }, (_, i) => (
        <SkeletonBar height={56} key={i} radius={cssVar.borderRadius} />
      ))}
    </Flexbox>
  ) : error && accounts.length === 0 ? (
    // A failed load must not read as "no accounts" — they would look identical.
    <Flexbox align={'center'} gap={12} paddingBlock={40}>
      <Empty description={t('subscriptionAccounts.loadFailed')} />
      <Button onClick={() => void revalidate()}>{t('retry', { ns: 'common' })}</Button>
    </Flexbox>
  ) : accounts.length === 0 ? (
    <Empty
      description={t('subscriptionAccounts.empty.desc')}
      style={{ paddingBlock: 40 }}
      title={t('subscriptionAccounts.empty.title')}
    />
  ) : (
    // The settings pane hides horizontal overflow, so a narrow pane scrolls the
    // list sideways rather than clipping the switch and menu off the row.
    <div style={{ overflowX: 'auto' }}>
      <Flexbox gap={2} style={{ minWidth: LIST_MIN_WIDTH }}>
        <AccountListHeader />
        {visible.map((account) => (
          <AccountRow
            account={account}
            active={account.id === openId}
            key={account.id}
            onOpen={() => setOpenId(account.id)}
          />
        ))}
        {visible.length === 0 && (
          <Empty description={t('subscriptionAccounts.filterEmpty')} style={{ paddingBlock: 40 }} />
        )}
      </Flexbox>
    </div>
  );

  return (
    <Flexbox gap={16} width={'100%'}>
      <Flexbox horizontal align={'center'} gap={12} justify={'space-between'} wrap={'wrap'}>
        <Text fontSize={13} type={'secondary'}>
          {accounts.length > 0 &&
            t('subscriptionAccounts.summary', { count: accounts.length, inRotation })}
        </Text>
        {/* Filters sit on the right as a dropdown: the provider list grows with
            every coding plan we support, which a segmented control cannot hold. */}
        <Flexbox horizontal align={'center'} gap={8}>
          <SearchBar
            allowClear
            placeholder={t('subscriptionAccounts.searchPlaceholder')}
            style={{ width: 240 }}
            value={keyword}
            variant={'filled'}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Select
            style={{ minWidth: 168 }}
            value={active}
            variant={'filled'}
            options={[
              {
                label: `${t('subscriptionAccounts.filter.all')} · ${accounts.length}`,
                value: ALL,
              },
              ...present.map((p) => ({
                label: `${PROVIDER_NAME[p]} · ${accounts.filter((a) => a.provider === p).length}`,
                value: p,
              })),
            ]}
            onChange={(value) => setProvider(value as SubscriptionProvider | typeof ALL)}
          />
          <ActionIcon
            icon={RefreshCwIcon}
            loading={isValidating || refreshing}
            title={t('subscriptionAccounts.refresh')}
            onClick={() => void refresh()}
          />
        </Flexbox>
      </Flexbox>
      <Flexbox horizontal gap={20} style={{ minWidth: 0 }}>
        <Flexbox flex={1} style={{ minWidth: 0 }}>
          {body}
        </Flexbox>
        {openAccount && (
          <AccountDetailPanel
            account={openAccount}
            key={openAccount.id}
            onClose={() => setOpenId(undefined)}
          />
        )}
      </Flexbox>
    </Flexbox>
  );
};

export default SubscriptionAccounts;
