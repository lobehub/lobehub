'use client';

import { type CredType } from '@lobechat/types';
import { Block, Flexbox, Tooltip } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo, type ReactNode, useState } from 'react';

import CreateCredButton from '@/features/Settings/creds/features/CreateCredButton';
import { createCreateCredModal } from '@/features/Settings/creds/features/CreateCredModal';
import { type CredFilter } from '@/features/Settings/creds/features/credFilter';
import CredsList from '@/features/Settings/creds/features/CredsList';
import { personalCredsApi } from '@/features/Settings/creds/features/useCredsApi';
import VaultFilterBar from '@/features/Settings/creds/features/VaultFilterBar';
import { usePermission } from '@/hooks/usePermission';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';

import { vaultStyles } from './vaultStyles';

interface PersonalVaultProps {
  /** The page tabs, at the left of the header row. */
  headerLeading: ReactNode;
}

/**
 * The vault tab of the personal Environments & Vault page: every credential
 * here is the caller's own, so the header only searches and filters by type.
 */
const PersonalVault = memo<PersonalVaultProps>(({ headerLeading }) => {
  const { isAuthenticated } = useMarketAuth();
  const { allowed: canManageCredentials, reason } = usePermission('manage_provider_key');
  const [refreshKey, setRefreshKey] = useState(0);
  const [filter, setFilter] = useState<CredFilter>({});
  // Same query and options as CredsList, so the tab counts read its cache.
  const { data } = personalCredsApi.query.list.useQuery(undefined, { enabled: isAuthenticated });

  const handleCreate = (type: CredType) => {
    if (!canManageCredentials) return;
    createCreateCredModal({
      credsApi: personalCredsApi,
      onSuccess: () => setRefreshKey((k) => k + 1),
      type,
    });
  };

  return (
    <Flexbox gap={16}>
      <Flexbox horizontal align={'center'} gap={16} justify={'space-between'} wrap={'wrap'}>
        {headerLeading}
        <Tooltip title={reason}>
          <span>
            <CreateCredButton disabled={!canManageCredentials} onCreate={handleCreate} />
          </span>
        </Tooltip>
      </Flexbox>
      {isAuthenticated && (
        <VaultFilterBar creds={data?.data ?? []} value={filter} onChange={setFilter} />
      )}
      <Block className={stylex.props(vaultStyles.container).className} variant={'outlined'}>
        <CredsList filter={filter} key={refreshKey} />
      </Block>
    </Flexbox>
  );
});

PersonalVault.displayName = 'PersonalVault';

export default PersonalVault;
