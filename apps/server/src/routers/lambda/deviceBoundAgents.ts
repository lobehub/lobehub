import type { LobeChatDatabase } from '@lobechat/database';
import type {
  AgentDeviceOverride,
  DeviceBoundAgentItem,
  LobeAgentAgencyConfig,
} from '@lobechat/types';
import { resolveAgentAgencyConfig } from '@lobechat/types';
import pMap from 'p-map';

import { AgentModel, type DeviceBindingCandidate } from '@/database/models/agent';
import { WorkspaceUserSettingsModel } from '@/database/models/workspaceUserSettings';
import { isResourceAuthorOrAdmin } from '@/server/services/resourcePermission';

/** Permission lookups are DB reads; a caller with many overrides must not open them all at once. */
const PERMISSION_LOOKUP_CONCURRENCY = 5;

const routesToDevice = (config: LobeAgentAgencyConfig | undefined, deviceId: string) =>
  config?.boundDeviceId === deviceId &&
  (config.executionTarget === 'device' || config.executionTarget === 'local');

/**
 * Keep the candidates whose EFFECTIVE execution target, for this caller, is
 * the device. The caller's override replaces the stored routing the same way
 * a run resolves it (`resolveAgentAgencyConfig`), so an agent the caller moved
 * to another device or the sandbox drops off the stored device, and one they
 * moved here appears — never on two devices at once.
 */
export const selectEffectivelyBoundAgents = (
  candidates: DeviceBindingCandidate[],
  {
    canManage,
    deviceId,
    overrides,
  }: {
    canManage: ReadonlySet<string>;
    deviceId: string;
    overrides: Record<string, AgentDeviceOverride>;
  },
): DeviceBoundAgentItem[] =>
  candidates
    .filter((agent) =>
      routesToDevice(
        resolveAgentAgencyConfig(agent.agencyConfig, overrides[agent.id], {
          canManage: canManage.has(agent.id),
          visibility: agent.visibility,
          workspaceId: agent.workspaceId,
        }),
        deviceId,
      ),
    )
    .map(({ avatar, backgroundColor, id, name, title, visibility }) => ({
      avatar,
      backgroundColor,
      id,
      name,
      title,
      visibility,
    }));

/**
 * Agents routed to `deviceId` for the caller: stored bindings plus the
 * caller's own workspace device overrides, resolved to the effective target.
 */
export const loadDeviceBoundAgents = async ({
  db,
  deviceId,
  userId,
  workspaceId,
}: {
  db: LobeChatDatabase;
  deviceId: string;
  userId: string;
  workspaceId?: string;
}): Promise<DeviceBoundAgentItem[]> => {
  // Overrides only exist per workspace; a personal agent's stored config is final.
  const overrides = workspaceId
    ? ((await new WorkspaceUserSettingsModel(db, userId, workspaceId).getPreference())
        .agentDeviceOverrides ?? {})
    : {};

  const candidates = await new AgentModel(db, userId, workspaceId).queryBoundToDevice(
    deviceId,
    Object.entries(overrides)
      .filter(([, override]) => override.boundDeviceId === deviceId)
      .map(([agentId]) => agentId),
  );

  // Management access only changes the outcome when an override exists (it
  // decides whether a `fixed` policy may ignore it), so look it up only then —
  // with the same author-or-admin check the run path uses, failing closed.
  const canManage = new Set<string>();
  await pMap(
    candidates.filter((agent) => overrides[agent.id]),
    async (agent) => {
      if (agent.userId === userId) {
        canManage.add(agent.id);
        return;
      }
      if (!agent.workspaceId || agent.visibility === 'private') return;
      try {
        const allowed = await isResourceAuthorOrAdmin({
          db,
          meta: {
            userId: agent.userId,
            visibility: agent.visibility,
            workspaceId: agent.workspaceId,
          },
          resourceType: 'agent',
          userId,
          workspaceId: agent.workspaceId,
        });
        if (allowed) canManage.add(agent.id);
      } catch {
        // Member semantics are the safe default when access can't be resolved.
      }
    },
    { concurrency: PERMISSION_LOOKUP_CONCURRENCY },
  );

  return selectEffectivelyBoundAgents(candidates, { canManage, deviceId, overrides });
};
