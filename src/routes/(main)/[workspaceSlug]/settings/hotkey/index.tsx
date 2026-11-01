'use client';

import HotkeySetting from '@/features/Settings/hotkey';

/**
 * Account hotkeys mirrored under `/:workspaceSlug/settings/hotkey`.
 * User-scoped; the workspace shell renders the compact header, so the page
 * header is hidden.
 */
const WorkspaceHotkeySetting = () => <HotkeySetting showSettingHeader={false} />;

WorkspaceHotkeySetting.displayName = 'WorkspaceHotkeySetting';

export default WorkspaceHotkeySetting;
