'use client';

import IntegrationsSetting from '@/features/Settings/integrations';

/**
 * Third-party integrations mirrored under
 * `/:workspaceSlug/settings/integrations[/:sub]`. An installation connected
 * here binds to the workspace, so members share it; the workspace shell
 * renders the compact header, so the page header is hidden. The integration
 * detail level reads `sub` via `useParams` inside the feature, exactly as
 * the personal route does.
 */
const WorkspaceIntegrationsSetting = () => <IntegrationsSetting showSettingHeader={false} />;

WorkspaceIntegrationsSetting.displayName = 'WorkspaceIntegrationsSetting';

export default WorkspaceIntegrationsSetting;
