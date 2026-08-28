'use client';

import { WorkspaceApiKeyGuard } from '@/business/client/BusinessSettingPages/WorkspaceApiKeyGuard';
import Page from '@/features/Settings/apikey';

const WorkspaceApiKeySetting = () => (
  <WorkspaceApiKeyGuard>
    <Page showSettingHeader={false} />
  </WorkspaceApiKeyGuard>
);

WorkspaceApiKeySetting.displayName = 'WorkspaceApiKeySetting';

export default WorkspaceApiKeySetting;
