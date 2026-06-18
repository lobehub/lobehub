'use client';

import { useTranslation } from 'react-i18next';

import WorkspaceStorageContent from '@/features/WorkspaceSetting/Storage';
import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

const WorkspaceStorageSetting = () => {
  const { t } = useTranslation('setting');
  return (
    <>
      <SettingHeader title={t('tab.storage')} />
      <WorkspaceStorageContent />
    </>
  );
};

WorkspaceStorageSetting.displayName = 'WorkspaceStorageSetting';

export default WorkspaceStorageSetting;
