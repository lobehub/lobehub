'use client';

import { WorkspaceAdminOnly } from '@/features/WorkspaceSetting';
import Page from '@/routes/(main)/settings/apikey';

const WorkspaceApiKeySetting = () => (
  <WorkspaceAdminOnly>
    <Page />
  </WorkspaceAdminOnly>
);

WorkspaceApiKeySetting.displayName = 'WorkspaceApiKeySetting';

export default WorkspaceApiKeySetting;
