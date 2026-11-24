import { appEnv } from '@/envs/app';
import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';

import { createPageRoomClient } from './roomClient';

const hasRoomGateway = () => !!createPageRoomClient();

// Clients released before workspace-only rooms join a room for every page while
// this is on; it stays on until those clients are switched off.
export const isLegacyPageCollabEnabled = () => !!appEnv.ENABLE_PAGE_COLLAB && hasRoomGateway();

export const isWorkspacePageCollabEnabled = () =>
  !!appEnv.ENABLE_WORKSPACE_PAGE_COLLAB && hasRoomGateway();

export const isPageCollabEnabled = () =>
  isLegacyPageCollabEnabled() || isWorkspacePageCollabEnabled();

/**
 * Whether this user edits workspace pages through a room (runtime flag `page_collab`, off by
 * default). The client reads the same flag; this keeps a client that skips it out of the room.
 * A flag that can't be read counts as off, so the page falls back to HTTP saves.
 */
export const isPageCollabEnabledForUser = async (userId: string): Promise<boolean> => {
  try {
    return (await getServerFeatureFlagsStateFromRuntimeConfig(userId)).enablePageCollab === true;
  } catch (error) {
    console.error('[PageCollab] Failed to read the page_collab feature flag:', error);
    return false;
  }
};
