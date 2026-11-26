import type { AgentDeviceOverride, AgentModelOverride } from '@lobechat/types';

import { getActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
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
 * active workspace, in their own order (seeded from the workspace's default
 * pins).
 */
const sidebarPinnedItemIds = (s: UserStore): string[] =>
  s.workspaceUserPreference.sidebarPinnedItemIds ?? EMPTY_HIDDEN;

/**
 * How the server is about to set the caller's sidebar up from the workspace
 * (`sidebarInitialized`), so the sidebar can show it before the first
 * response arrives:
 *
 * - `teamPins` — saved choices from an earlier visit: a member who joined
 *   while team pins were shown, whose team pins will follow their own pins.
 * - `recommended` — nothing saved: a new member, whose recommended Agents
 *   will be listed, unpinned.
 * - `null` — already set up, or the server has answered: it sets the sidebar
 *   up in that same response whenever there is something to add, so an
 *   answer without the flag means there is nothing to preview.
 *
 * The server decides by join date; this guess only bridges the cached state
 * shown before its answer.
 */
const sidebarSetupPreview = (s: UserStore): 'recommended' | 'teamPins' | null => {
  const preference = s.workspaceUserPreference;
  if (preference.sidebarInitialized) return null;

  const workspaceId = getActiveWorkspaceId();
  if (!workspaceId || s.workspaceUserPreferenceReplica.entries[workspaceId]?.source === 'server')
    return null;

  return Object.keys(preference).length > 0 ? 'teamPins' : 'recommended';
};

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
  sidebarSetupPreview,
};
