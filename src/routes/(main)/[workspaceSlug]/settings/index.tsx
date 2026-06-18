'use client';

import { memo } from 'react';
import { Navigate } from 'react-router-dom';

import { DEFAULT_WORKSPACE_SETTINGS_TAB } from '@/types/workspaceSettings';

const WorkspaceSettingsIndex = memo(() => <Navigate replace to={DEFAULT_WORKSPACE_SETTINGS_TAB} />);

export default WorkspaceSettingsIndex;
