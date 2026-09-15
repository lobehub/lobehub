'use client';

import MessengerSetting from '@/features/Settings/messenger';

/**
 * Account messenger bindings mirrored under
 * `/:workspaceSlug/settings/messenger[/:sub]`. The binding is user-scoped;
 * the workspace shell renders the compact header, so the page header is
 * hidden. The platform detail level reads `sub` via `useParams` inside the
 * feature, exactly as the personal route does.
 */
const WorkspaceMessengerSetting = () => <MessengerSetting showSettingHeader={false} />;

WorkspaceMessengerSetting.displayName = 'WorkspaceMessengerSetting';

export default WorkspaceMessengerSetting;
