'use client';

import { Button, Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';

import SettingsPageActions from '../features/SettingsPageActions';
import { createCreateCredModal } from './features/CreateCredModal';
import CredsList from './features/CredsList';
import { personalCredsApi } from './features/useCredsApi';

interface PageProps {
  mobile?: boolean;
}

const Page = ({ mobile }: PageProps) => {
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

  const createButton = (
    <Tooltip title={reason}>
      <Button
        disabled={!canManageCredentials}
        icon={<Icon icon={Plus} />}
        size={mobile ? 'large' : undefined}
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

  // The shared settings header shows the title; the button joins its right slot.
  return (
    <>
      <SettingsPageActions>{createButton}</SettingsPageActions>
      <CredsList key={refreshKey} />
    </>
  );
};

Page.displayName = 'CredsSetting';

export default Page;
