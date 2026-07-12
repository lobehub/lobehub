import type { AgentDeviceOverride } from '@lobechat/types';
import { resolveOverrideBySource } from '@lobechat/types';

import { type UserStore } from '@/store/user';

/**
 * The caller's per-source-device override for a specific workspace agent.
 * Returns the override matching `sourceDeviceId`, falling back to `'*'`.
 *
 * Backward-compat: if the stored value has `executionTarget` at the top level
 * (old flat format), returns it directly.
 */
const agentDeviceOverrideById =
  (agentId: string, sourceDeviceId?: string) =>
  (s: UserStore): AgentDeviceOverride | undefined => {
    const raw = s.workspaceUserPreference.agentDeviceOverrides?.[agentId];
    if (!raw) return undefined;

    // Old format: a flat AgentDeviceOverride with executionTarget at top level
    if ('executionTarget' in raw || 'boundDeviceId' in raw) {
      return raw as unknown as AgentDeviceOverride;
    }

    return resolveOverrideBySource(raw as Record<string, AgentDeviceOverride>, sourceDeviceId);
  };

export const workspaceUserSettingsSelectors = {
  agentDeviceOverrideById,
};
