'use client';

import { WorkspaceApiKeyGuard } from '@/business/client/BusinessSettingPages/WorkspaceApiKeyGuard';
import Page from '@/features/Settings/webhook';

/**
 * Same page as personal settings; the list follows the active workspace. Webhooks
 * serve the same API integrations as API keys, so they share the workspace gate.
 */
const WorkspaceWebhookSetting = () => (
  <WorkspaceApiKeyGuard>
    <Page showSettingHeader={false} />
  </WorkspaceApiKeyGuard>
);

WorkspaceWebhookSetting.displayName = 'WorkspaceWebhookSetting';

export default WorkspaceWebhookSetting;
