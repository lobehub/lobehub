'use client';

import { Navigate } from 'react-router';

import { DEFAULT_WORKSPACE_SETTINGS_TAB } from '@/types/workspaceSettings';

const WorkspaceSettingsIndex = () => <Navigate replace to={DEFAULT_WORKSPACE_SETTINGS_TAB} />;

export default WorkspaceSettingsIndex;
