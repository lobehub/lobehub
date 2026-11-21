import type { AgentDeviceOverride, AgentModelOverride } from '@lobechat/types';

import { type UserStore } from '@/store/user';

/**
 * The caller's override for a specific agent in the currently-active
 * workspace, or `undefined` when nothing is pinned yet. Merged over
 * `agents.agencyConfig` by `resolveAgencyConfig` at read time so pickers and
 * dispatch always agree.
 */
const agentDeviceOverrideById =
  (agentId: string) =>
  (s: UserStore): AgentDeviceOverride | undefined =>
    s.workspaceUserPreference.agentDeviceOverrides?.[agentId];

/** The caller's personal model choice for one agent in the active workspace. */
const agentModelOverrideById =
  (agentId: string) =>
  (s: UserStore): AgentModelOverride | undefined =>
    s.workspaceUserPreference.agentModelOverrides?.[agentId];

const EMPTY_HIDDEN: string[] = [];
const EMPTY_VISIBILITY_OVERRIDES: Record<string, boolean> = {};

/** Explicit per-member workspace sidebar membership overrides. */
const sidebarAgentVisibilityOverrides = (s: UserStore): Record<string, boolean> =>
  s.workspaceUserPreference.sidebarAgentVisibilityOverrides ?? EMPTY_VISIBILITY_OVERRIDES;

/**
 * Sidebar items the caller removed from their sidebar in the active
 * workspace. Empty in personal mode (the preference bucket never loads
 * there — the personal counterpart lives in `users.preference`).
 */
const sidebarHiddenAgentIds = (s: UserStore): string[] =>
  s.workspaceUserPreference.sidebarHiddenAgentIds ?? EMPTY_HIDDEN;

/**
 * Folders (Categories) the caller hid from their sidebar in the active
 * workspace. The folders themselves stay shared — this is the personal mask.
 */
const sidebarHiddenGroupIds = (s: UserStore): string[] =>
  s.workspaceUserPreference.sidebarHiddenGroupIds ?? EMPTY_HIDDEN;

/** Whether the caller removed this item from their sidebar (default is listed). */
const isAgentHiddenFromSidebar =
  (agentId: string) =>
  (s: UserStore): boolean =>
    !!s.workspaceUserPreference.sidebarHiddenAgentIds?.includes(agentId);

/**
 * Agents / chat groups pinned in the caller's merged Agents section of the
 * active workspace, in their own order (team pins they kept included once
 * they rearranged the list).
 */
const sidebarPinnedItemIds = (s: UserStore): string[] =>
  s.workspaceUserPreference.sidebarPinnedItemIds ?? EMPTY_HIDDEN;

/** Whether the caller rearranged their pinned list in the active workspace. */
const sidebarPinnedOrderCustomized = (s: UserStore): boolean =>
  !!s.workspaceUserPreference.sidebarPinnedOrderCustomized;

/** Team pins the caller unpinned for themselves in the active workspace. */
const sidebarUnpinnedTeamItemIds = (s: UserStore): string[] =>
  s.workspaceUserPreference.sidebarUnpinnedTeamItemIds ?? EMPTY_HIDDEN;

/** Per-member sidebar sections layout for the active workspace. */
const sidebarLayout = (s: UserStore) => s.workspaceUserPreference.sidebar;

/** The workspace whose preference row is currently loaded (null = not yet fetched). */
const preferenceWorkspaceId = (s: UserStore) => s.workspaceUserPreferenceWorkspaceId;

export const workspaceUserSettingsSelectors = {
  agentDeviceOverrideById,
  agentModelOverrideById,
  isAgentHiddenFromSidebar,
  preferenceWorkspaceId,
  sidebarAgentVisibilityOverrides,
  sidebarHiddenAgentIds,
  sidebarHiddenGroupIds,
  sidebarLayout,
  sidebarPinnedItemIds,
  sidebarPinnedOrderCustomized,
  sidebarUnpinnedTeamItemIds,
};
