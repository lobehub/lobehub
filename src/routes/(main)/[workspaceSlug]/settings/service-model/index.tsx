'use client';

import Page from '@/features/Settings/service-model';
import WorkspaceAdminOnly from '@/features/WorkspaceSetting/AdminOnly';

const WorkspaceServiceModelSetting = () => (
  <WorkspaceAdminOnly>
    {/* Follow-up / input completion are personal: members edit them on the
        Chat Preferences tab, so admins don't get a second entry here. */}
    <Page hidePersonalPreferences showSettingHeader={false} />
  </WorkspaceAdminOnly>
);

WorkspaceServiceModelSetting.displayName = 'WorkspaceServiceModelSetting';

export default WorkspaceServiceModelSetting;
