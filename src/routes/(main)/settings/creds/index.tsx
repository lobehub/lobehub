'use client';

import { Button, Icon } from '@lobehub/ui';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

import { createCreateCredModal } from './features/CreateCredModal';
import CredsList from './features/CredsList';

const Page = () => {
  const { t } = useTranslation('setting');
  const [refreshKey, setRefreshKey] = useState(0);

  const handleCreate = () => {
    createCreateCredModal({
      onSuccess: () => setRefreshKey((k) => k + 1),
    });
  };

  return (
    <>
      <SettingHeader
        title={t('tab.creds')}
        extra={
          <Button icon={<Icon icon={Plus} />} size={'large'} onClick={handleCreate}>
            {t('creds.create')}
          </Button>
        }
      />
      <CredsList key={refreshKey} />
    </>
  );
};

Page.displayName = 'CredsSetting';

export default Page;
