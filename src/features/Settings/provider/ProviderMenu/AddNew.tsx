'use client';

import { ActionIcon, Tooltip } from '@lobehub/ui';
import { PlusIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { useHeaderActionSize } from '@/styles/density';

import { createCreateNewProviderModal } from '../features/CreateNewProvider';

const AddNewProvider = () => {
  const headerActionSize = useHeaderActionSize(true);
  const { t } = useTranslation('modelProvider');
  const { allowed: canManageProvider, reason } = usePermission('manage_provider_key');

  const button = (
    <ActionIcon
      disabled={!canManageProvider}
      icon={PlusIcon}
      size={headerActionSize}
      title={canManageProvider ? t('menu.addCustomProvider') : undefined}
      onClick={() => {
        if (!canManageProvider) return;
        createCreateNewProviderModal();
      }}
    />
  );

  return canManageProvider ? button : <Tooltip title={reason}>{button}</Tooltip>;
};

export default AddNewProvider;
