'use client';

import { ActionIcon, Tooltip } from '@lobehub/ui';
import { PlusIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { usePermission } from '@/hooks/usePermission';

import { createCreateNewProviderModal } from '../features/CreateNewProvider';

const AddNewProvider = () => {
  const { t } = useTranslation('modelProvider');
  const { allowed: canManageProvider, reason } = usePermission('manage_provider_key');

  const button = (
    <ActionIcon
      disabled={!canManageProvider}
      icon={PlusIcon}
      size={DESKTOP_HEADER_ICON_SMALL_SIZE}
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
