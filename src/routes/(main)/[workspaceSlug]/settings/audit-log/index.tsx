'use client';

import WorkspaceAuditLog from '@/business/client/BusinessSettingPages/WorkspaceAuditLog';
import { WorkspaceAdminOnly } from '@/features/WorkspaceSetting';

const Page = () => (
  <WorkspaceAdminOnly>
    <WorkspaceAuditLog />
  </WorkspaceAdminOnly>
);

Page.displayName = 'WorkspaceAuditLogPage';

export default Page;
