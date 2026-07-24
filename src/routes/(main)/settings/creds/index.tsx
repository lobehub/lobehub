'use client';

import { Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import NavHeader from '@/features/NavHeader';
import SettingContainer from '@/features/Setting/SettingContainer';
import { usePermission } from '@/hooks/usePermission';

import { createCreateCredModal } from './features/CreateCredModal';
import CredsList from './features/CredsList';
import { useCredsApi } from './features/useCredsApi';

interface PageProps {
  mobile?: boolean;
}

const Page = ({ mobile }: PageProps) => {
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

  const createButton = (
    <Tooltip title={reason}>
      <Button
        disabled={!canManageCredentials}
        icon={<Icon icon={Plus} />}
        size={mobile ? 'large' : 'small'}
        type={'primary'}
        onClick={handleCreate}
      >
        {t('creds.create')}
      </Button>
    </Tooltip>
  );

  if (mobile) {
    return (
      <>
        <Flexbox horizontal justify={'flex-end'} padding={16}>
          {createButton}
        </Flexbox>
        <CredsList key={refreshKey} />
      </>
    );
  }

  return (
    <>
      <NavHeader right={createButton} styles={{ center: { alignItems: 'center' } }}>
        <Text weight={500}>{t('tab.creds')}</Text>
      </NavHeader>
      <SettingContainer maxWidth={1024} paddingBlock={'24px 128px'} paddingInline={24}>
        <CredsList key={refreshKey} />
      </SettingContainer>
    </>
  );
};

Page.displayName = 'CredsSetting';

export default Page;
