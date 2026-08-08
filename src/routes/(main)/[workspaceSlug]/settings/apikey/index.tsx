'use client';

import WorkspaceApiKeyGuard from '@/business/client/BusinessSettingPages/WorkspaceApiKeyGuard';
import Page from '@/features/Settings/apikey';
import { WorkspaceAdminOnly } from '@/features/WorkspaceSetting';

const WorkspaceApiKeySetting = () => (
  <WorkspaceAdminOnly>
    <WorkspaceApiKeyGuard>
      <Page showSettingHeader={false} />
    </WorkspaceApiKeyGuard>
  </WorkspaceAdminOnly>
);

WorkspaceApiKeySetting.displayName = 'WorkspaceApiKeySetting';

export default WorkspaceApiKeySetting;
