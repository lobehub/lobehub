'use client';

import WorkspaceApiKeyGuard from '@/business/client/BusinessSettingPages/WorkspaceApiKeyGuard';
import { WorkspaceAdminOnly } from '@/features/WorkspaceSetting';
import Page from '@/routes/(main)/settings/apikey';

const WorkspaceApiKeySetting = () => (
  <WorkspaceAdminOnly>
    <WorkspaceApiKeyGuard>
      <Page showSettingHeader={false} />
    </WorkspaceApiKeyGuard>
  </WorkspaceAdminOnly>
);

WorkspaceApiKeySetting.displayName = 'WorkspaceApiKeySetting';

export default WorkspaceApiKeySetting;
