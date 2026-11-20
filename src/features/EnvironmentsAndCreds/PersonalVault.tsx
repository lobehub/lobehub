'use client';

import { Button, Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { Plus } from 'lucide-react';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { createCreateCredModal } from '@/features/Settings/creds/features/CreateCredModal';
import CredsList from '@/features/Settings/creds/features/CredsList';
import { personalCredsApi } from '@/features/Settings/creds/features/useCredsApi';
import { usePermission } from '@/hooks/usePermission';

interface PersonalVaultProps {
  /** The page tabs, at the left of the header row. */
  headerLeading: ReactNode;
}

/**
 * The vault tab of the personal Environments & Vault page: every credential
 * here is the caller's own, so there is nothing to filter.
 */
const PersonalVault = memo<PersonalVaultProps>(({ headerLeading }) => {
  const { t } = useTranslation('setting');
  const { allowed: canManageCredentials, reason } = usePermission('manage_provider_key');
  const [refreshKey, setRefreshKey] = useState(0);

  const handleCreate = () => {
    if (!canManageCredentials) return;
    createCreateCredModal({
      credsApi: personalCredsApi,
      onSuccess: () => setRefreshKey((k) => k + 1),
    });
  };

  return (
    <Flexbox gap={16}>
      <Flexbox horizontal align={'center'} gap={16} justify={'space-between'} wrap={'wrap'}>
        {headerLeading}
        <Tooltip title={reason}>
          <Button
            disabled={!canManageCredentials}
            icon={<Icon icon={Plus} />}
            style={{ flex: 'none' }}
            type={'primary'}
            onClick={handleCreate}
          >
            {t('creds.create')}
          </Button>
        </Tooltip>
      </Flexbox>
      <CredsList key={refreshKey} />
    </Flexbox>
  );
});

PersonalVault.displayName = 'PersonalVault';

export default PersonalVault;
