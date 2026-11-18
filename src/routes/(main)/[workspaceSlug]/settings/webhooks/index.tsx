'use client';

import Page from '@/features/Settings/webhooks';

/** Same page as personal settings; the list follows the active workspace. */
const WorkspaceWebhooksSetting = () => <Page showSettingHeader={false} />;

WorkspaceWebhooksSetting.displayName = 'WorkspaceWebhooksSetting';

export default WorkspaceWebhooksSetting;
