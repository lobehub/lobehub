'use client';

import AppearanceSetting from '@/features/Settings/appearance';

/**
 * Account appearance preferences mirrored under
 * `/:workspaceSlug/settings/appearance`. User-scoped; the workspace shell
 * renders the compact header, so the page header is hidden.
 */
const WorkspaceAppearanceSetting = () => <AppearanceSetting showSettingHeader={false} />;

WorkspaceAppearanceSetting.displayName = 'WorkspaceAppearanceSetting';

export default WorkspaceAppearanceSetting;
