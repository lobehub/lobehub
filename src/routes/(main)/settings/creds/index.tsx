'use client';

import { Icon, Tooltip } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

import { createCreateCredModal } from './features/CreateCredModal';
import CredsList from './features/CredsList';
import { useCredsApi } from './features/useCredsApi';

const Page = () => {
  const { t } = useTranslation('setting');
  const { allowed: canManageCredentials, reason } = usePermission('manage_provider_key');
  const [refreshKey, setRefreshKey] = useState(0);
  const credsApi = useCredsApi();

  const handleCreate = () => {
    if (!canManageCredentials) return;
    createCreateCredModal({
      credsApi,
      onSuccess: () => setRefreshKey((k) => k + 1),
    });
  };

  return (
    <>
      <SettingHeader
        title={t('tab.creds')}
        extra={
          <Tooltip title={reason}>
            <Button
              disabled={!canManageCredentials}
              icon={<Icon icon={Plus} />}
              size={'large'}
              onClick={handleCreate}
            >
              {t('creds.create')}
            </Button>
          </Tooltip>
        }
      />
      <CredsList key={refreshKey} />
    </>
  );
};

Page.displayName = 'CredsSetting';

export default Page;
