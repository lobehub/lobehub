'use client';

import WorkspaceApiKeyGuard from '@/business/client/BusinessSettingPages/WorkspaceApiKeyGuard';
import Page from '@/routes/(main)/settings/apikey';

// Workspace API keys are visible to every member (each sees the full list; the
// plaintext secret is returned only for their own keys). Creating/editing/
// deleting is enforced per-row on the server (creator or workspace owner), so
// this page is intentionally NOT gated behind WorkspaceAdminOnly.
const WorkspaceApiKeySetting = () => (
  <WorkspaceApiKeyGuard>
    <Page />
  </WorkspaceApiKeyGuard>
);

WorkspaceApiKeySetting.displayName = 'WorkspaceApiKeySetting';

export default WorkspaceApiKeySetting;
