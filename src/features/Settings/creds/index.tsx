'use client';

import { type CredType } from '@lobechat/types';
import { Flexbox, Tooltip } from '@lobehub/ui';
import { useState } from 'react';

import { usePermission } from '@/hooks/usePermission';

import SettingsPageActions from '../features/SettingsPageActions';
import CreateCredButton from './features/CreateCredButton';
import { createCreateCredModal } from './features/CreateCredModal';
import CredsList from './features/CredsList';
import { personalCredsApi } from './features/useCredsApi';

interface PageProps {
  mobile?: boolean;
}

const Page = ({ mobile }: PageProps) => {
  const { allowed: canManageCredentials, reason } = usePermission('manage_provider_key');
  const [refreshKey, setRefreshKey] = useState(0);

  const handleCreate = (type: CredType) => {
    if (!canManageCredentials) return;
    createCreateCredModal({
      credsApi: personalCredsApi,
      onSuccess: () => setRefreshKey((k) => k + 1),
      type,
    });
  };

  const createButton = (
    <Tooltip title={reason}>
      <span>
        <CreateCredButton
          disabled={!canManageCredentials}
          size={mobile ? 'large' : undefined}
          onCreate={handleCreate}
        />
      </span>
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
