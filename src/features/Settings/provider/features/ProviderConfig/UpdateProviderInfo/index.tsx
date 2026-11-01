'use client';

import { Button, Tooltip } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { SettingsIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';

import { createSettingModal } from './SettingModal';

const UpdateProviderInfo = memo(() => {
  const { t } = useTranslation('modelProvider');

  const providerConfig = useAiInfraStore(aiProviderSelectors.activeProviderConfig, isEqual);
  const { allowed: canManageProvider, reason } = usePermission('manage_provider_key');

  return (
    <Tooltip title={canManageProvider ? t('updateAiProvider.tooltip') : reason}>
      <Button
        disabled={!canManageProvider}
        icon={SettingsIcon}
        size={'small'}
        type={'text'}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!canManageProvider || !providerConfig) return;
          createSettingModal({
            id: providerConfig.id,
            initialValues: providerConfig,
          });
        }}
      />
    </Tooltip>
  );
});

export default UpdateProviderInfo;
