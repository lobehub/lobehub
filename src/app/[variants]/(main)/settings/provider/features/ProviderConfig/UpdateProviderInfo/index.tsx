'use client';

import { Button, Tooltip } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { SettingsIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';

import SettingModal from './SettingModal';

const UpdateProviderInfo = memo(() => {
  const { t } = useTranslation('modelProvider');

  const [open, setOpen] = useState(false);
  const providerConfig = useAiInfraStore(aiProviderSelectors.activeProviderConfig, isEqual);

  return (
    <>
      <Tooltip title={t('updateAiProvider.tooltip')}>
        <Button
          icon={SettingsIcon}
          size={'small'}
          type={'text'}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
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
