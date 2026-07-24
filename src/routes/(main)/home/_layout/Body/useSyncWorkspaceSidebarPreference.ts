import type { SidebarLayoutPreference } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { useEffect } from 'react';

import { useGlobalStore } from '@/store/global';
import { useUserStore } from '@/store/user';
import { workspaceUserSettingsSelectors } from '@/store/user/selectors';

/**
 * Two-way bridge between the client-side sidebar layout overlay
 * (`status.workspace.sidebarItems` / `.hiddenSidebarSections` — a single
 * device-local bucket) and the per-member server preference
 * (`workspace_user_settings.preference.sidebar`), so each member's section
 * order and hidden sections follow them across devices.
 *
 * - Pull: server value → overlay whenever they diverge (workspace switch,
 *   another device's edit arriving via SWR revalidation).
 * - Push: local overlay edits (customize-sidebar modal, "Hide Section") →
 *   server, skipped when the overlay already equals the server value (which
 *   is exactly the state a pull leaves behind, so the bridge cannot loop).
 *
 * Expansion state (`sidebarExpandedKeys` etc.) deliberately stays local.
 */
export const useSyncWorkspaceSidebarPreference = (workspaceId: string | null) => {
  const serverSidebar = useUserStore(workspaceUserSettingsSelectors.sidebarLayout, isEqual);
  const loadedWorkspaceId = useUserStore(workspaceUserSettingsSelectors.preferenceWorkspaceId);

  // Pull: apply the per-member server layout onto the local overlay.
  useEffect(() => {
    // Only trust the preference bucket once it holds THIS workspace's row —
    // before that, `serverSidebar` may be the previous workspace's value (or
    // an unfetched placeholder) and must not be pulled or cleared from.
    if (!workspaceId || loadedWorkspaceId !== workspaceId) return;
    // Replace wholesale: a field the server preference does not carry must be
    // DELETED from the shared overlay bucket (not left behind by a deep
    // merge), or the previous workspace's layout leaks into this one.
    useGlobalStore.getState().setWorkspaceSidebarOverlay({
      hiddenSidebarSections: serverSidebar?.hiddenSections,
      sidebarItems: serverSidebar?.items,
    });
  }, [workspaceId, serverSidebar, loadedWorkspaceId]);

  // Push: persist local overlay edits (and seed the server from a
  // pre-existing local customization the first time it changes).
  useEffect(() => {
    // Same trust boundary as the pull effect: don't diff local edits against
    // (or seed the server from) another workspace's baseline.
    if (!workspaceId || loadedWorkspaceId !== workspaceId) return;
    return useGlobalStore.subscribe(
      (s) => ({
        hiddenSections: s.status.workspace?.hiddenSidebarSections,
        items: s.status.workspace?.sidebarItems,
      }),
      (overlay) => {
        if (overlay.items === undefined && overlay.hiddenSections === undefined) return;
        const state = useUserStore.getState();
        const current = state.workspaceUserPreference.sidebar;
        const next: SidebarLayoutPreference = {
          ...(overlay.hiddenSections ? { hiddenSections: overlay.hiddenSections } : {}),
          ...(overlay.items ? { items: overlay.items } : {}),
        };
        if (isEqual(current ?? {}, next)) return;
        void state.updateWorkspaceUserPreference({ sidebar: next });
      },
      { equalityFn: isEqual },
    );
  }, [workspaceId, loadedWorkspaceId]);
};
