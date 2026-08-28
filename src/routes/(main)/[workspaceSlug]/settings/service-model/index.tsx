'use client';

import Page from '@/features/Settings/service-model';
import WorkspaceAdminOnly from '@/features/WorkspaceSetting/AdminOnly';

const WorkspaceServiceModelSetting = () => (
  <WorkspaceAdminOnly>
    <Page showSettingHeader={false} />
  </WorkspaceAdminOnly>
);

WorkspaceServiceModelSetting.displayName = 'WorkspaceServiceModelSetting';

export default WorkspaceServiceModelSetting;
