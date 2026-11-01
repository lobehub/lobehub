'use client';

import ProfileSetting from '@/features/Settings/profile';

/**
 * Account profile mirrored under `/:workspaceSlug/settings/profile`.
 * The page is user-scoped; the workspace shell only supplies the chrome
 * (compact header + centered container), so the page header is hidden.
 */
const WorkspaceProfileSetting = () => <ProfileSetting showSettingHeader={false} />;

WorkspaceProfileSetting.displayName = 'WorkspaceProfileSetting';

export default WorkspaceProfileSetting;
