'use client';

import LabsSetting from '@/features/Settings/labs';

/**
 * Labs (experimental features) mirrored under `/:workspaceSlug/settings/labs`.
 * User-scoped preferences; the workspace shell renders the compact header, so
 * the page header is hidden.
 */
const WorkspaceLabsSetting = () => <LabsSetting showSettingHeader={false} />;

WorkspaceLabsSetting.displayName = 'WorkspaceLabsSetting';

export default WorkspaceLabsSetting;
