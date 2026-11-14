import { appEnv } from '@/envs/app';

import { createPageRoomClient } from './roomClient';

const hasRoomGateway = () => !!createPageRoomClient();

// Clients released before workspace-only rooms join a room for every page while
// this is on; it stays on until those clients are switched off.
export const isLegacyPageCollabEnabled = () => !!appEnv.ENABLE_PAGE_COLLAB && hasRoomGateway();

export const isWorkspacePageCollabEnabled = () =>
  !!appEnv.ENABLE_WORKSPACE_PAGE_COLLAB && hasRoomGateway();

export const isPageCollabEnabled = () =>
  isLegacyPageCollabEnabled() || isWorkspacePageCollabEnabled();
