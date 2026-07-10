'use client';

import { useTranslation } from 'react-i18next';

import { WorkspaceAdminOnly } from '@/features/WorkspaceSetting';
import WorkspaceStorageContent from '@/features/WorkspaceSetting/Storage';
import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

const WorkspaceStorageSetting = () => {
  const { t } = useTranslation('setting');
  return (
    <WorkspaceAdminOnly>
      <SettingHeader title={t('tab.storage')} />
      <WorkspaceStorageContent />
    </WorkspaceAdminOnly>
  );
};

WorkspaceStorageSetting.displayName = 'WorkspaceStorageSetting';

export default WorkspaceStorageSetting;
