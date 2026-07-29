'use client';

import WorkspaceAdminOnly from '@/features/WorkspaceSetting/AdminOnly';
import Page from '@/routes/(main)/settings/service-model';

const WorkspaceServiceModelSetting = () => (
  <WorkspaceAdminOnly>
    <Page showSettingHeader={false} />
  </WorkspaceAdminOnly>
);

WorkspaceServiceModelSetting.displayName = 'WorkspaceServiceModelSetting';

export default WorkspaceServiceModelSetting;
