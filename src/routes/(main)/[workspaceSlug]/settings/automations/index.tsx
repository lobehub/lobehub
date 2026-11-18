'use client';

import Page from '@/features/Settings/automations';

/** Same page as personal settings; the list follows the active workspace. */
const WorkspaceAutomationsSetting = () => <Page showSettingHeader={false} />;

WorkspaceAutomationsSetting.displayName = 'WorkspaceAutomationsSetting';

export default WorkspaceAutomationsSetting;
