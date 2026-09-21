'use client';

import AboutSetting from '@/features/Settings/about';

/**
 * About page mirrored under `/:workspaceSlug/settings/about`. Informational
 * and user-level; the workspace shell renders the compact header, so the page
 * header is hidden.
 */
const WorkspaceAboutSetting = () => <AboutSetting showSettingHeader={false} />;

WorkspaceAboutSetting.displayName = 'WorkspaceAboutSetting';

export default WorkspaceAboutSetting;
