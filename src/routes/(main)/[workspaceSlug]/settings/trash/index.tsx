'use client';

import { useFetchWorkspaceMembers } from '@/business/client/hooks/useFetchWorkspaceMembers';
import TrashSetting from '@/features/Settings/trash';

/**
 * Recycle bin mirrored under `/:workspaceSlug/settings/trash`. The list,
 * restore and purge run in the active workspace scope: a public side lists
 * every member's deletions of shared content, a private side only the
 * caller's own private deletions. The workspace shell renders the compact
 * header, so the page header is hidden. Members are loaded so the public side
 * can name who deleted each row.
 */
const WorkspaceTrashSetting = () => {
  useFetchWorkspaceMembers();

  return <TrashSetting isWorkspace showSettingHeader={false} />;
};

WorkspaceTrashSetting.displayName = 'WorkspaceTrashSetting';

export default WorkspaceTrashSetting;
