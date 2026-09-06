'use client';

import { useParams } from 'react-router';

import TrashSettings from '@/features/Settings/trash';

import { getWorkspaceTrashCacheScope } from './cacheScope';

const WorkspaceTrashSetting = () => {
  const { workspaceSlug = '' } = useParams<{ workspaceSlug: string }>();

  return (
    <TrashSettings
      cacheScope={getWorkspaceTrashCacheScope(workspaceSlug)}
      showSettingHeader={false}
    />
  );
};

WorkspaceTrashSetting.displayName = 'WorkspaceTrashSetting';

export default WorkspaceTrashSetting;
