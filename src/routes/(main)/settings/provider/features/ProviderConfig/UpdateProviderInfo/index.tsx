'use client';

import { Button, Tooltip } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { SettingsIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';

import SettingModal from './SettingModal';

const UpdateProviderInfo = memo(() => {
  const { t } = useTranslation('modelProvider');

  const [open, setOpen] = useState(false);
  const providerConfig = useAiInfraStore(aiProviderSelectors.activeProviderConfig, isEqual);
  const { allowed: canManageProvider, reason } = usePermission('manage_provider_key');

  return (
    <>
      <Tooltip title={canManageProvider ? t('updateAiProvider.tooltip') : reason}>
        <Button
          disabled={!canManageProvider}
          icon={SettingsIcon}
          size={'small'}
          type={'text'}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!canManageProvider) return;
            setOpen(true);
          }}
        />
      </Tooltip>
      {open && providerConfig && (
        <SettingModal
          id={providerConfig.id}
          initialValues={providerConfig}
          open={open}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
});

export default UpdateProviderInfo;
