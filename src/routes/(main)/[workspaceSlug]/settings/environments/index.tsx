'use client';

import Page from '@/features/Settings/environments';

/**
 * The workspace's environments. Same page as the personal one: the API scopes
 * the workspace off the active-workspace context, so the environments listed
 * and created here are the workspace's, judged by the workspace's plan.
 */
const WorkspaceEnvironmentsSetting = () => <Page />;

WorkspaceEnvironmentsSetting.displayName = 'WorkspaceEnvironmentsSetting';

export default WorkspaceEnvironmentsSetting;
