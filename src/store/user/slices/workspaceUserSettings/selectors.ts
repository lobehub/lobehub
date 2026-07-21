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

export const workspaceUserSettingsSelectors = {
  agentDeviceOverrideById,
  agentModelOverrideById,
};
