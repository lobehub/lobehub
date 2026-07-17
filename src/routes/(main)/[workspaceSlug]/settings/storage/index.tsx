'use client';

import { WorkspaceAdminOnly } from '@/features/WorkspaceSetting';
import WorkspaceStorageContent from '@/features/WorkspaceSetting/Storage';

const WorkspaceStorageSetting = () => (
  <WorkspaceAdminOnly>
    <WorkspaceStorageContent />
  </WorkspaceAdminOnly>
);

WorkspaceStorageSetting.displayName = 'WorkspaceStorageSetting';

export default WorkspaceStorageSetting;
