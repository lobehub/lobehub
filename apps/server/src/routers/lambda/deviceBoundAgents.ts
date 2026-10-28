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

/**
 * The device a config actually routes to. A stored `boundDeviceId` is only
 * honoured by the `device` and `local` targets: it intentionally lingers after
 * switching to the sandbox or `none`, and `auto` treats it as stale.
 */
const routedDeviceId = (config: LobeAgentAgencyConfig | undefined): string | undefined =>
  config?.executionTarget === 'device' || config?.executionTarget === 'local'
    ? config.boundDeviceId
    : undefined;

const routesToDevice = (config: LobeAgentAgencyConfig | undefined, deviceId: string) =>
  routedDeviceId(config) === deviceId;

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
 * Agents of `candidates` the caller manages. Management access only changes the
 * outcome when an override exists (it decides whether a `fixed` policy may
 * ignore it), so look it up only then — with the same author-or-admin check
 * the run path uses, failing closed.
 */
const resolveManagedAgentIds = async ({
  candidates,
  db,
  overrides,
  userId,
}: {
  candidates: DeviceBindingCandidate[];
  db: LobeChatDatabase;
  overrides: Record<string, AgentDeviceOverride>;
  userId: string;
}): Promise<Set<string>> => {
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

  return canManage;
};

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

  const canManage = await resolveManagedAgentIds({ candidates, db, overrides, userId });

  return selectEffectivelyBoundAgents(candidates, { canManage, deviceId, overrides });
};

/**
 * Where each of `candidates` routes for this caller: the stored config merged
 * with the caller's own override, exactly as a run resolves it. Agents that
 * route nowhere (sandbox, none, auto, unbound) are absent.
 */
export const selectAgentDeviceBindings = (
  candidates: DeviceBindingCandidate[],
  {
    canManage,
    overrides,
  }: {
    canManage: ReadonlySet<string>;
    overrides: Record<string, AgentDeviceOverride>;
  },
): Record<string, string> => {
  const bindings: Record<string, string> = {};
  for (const agent of candidates) {
    const deviceId = routedDeviceId(
      resolveAgentAgencyConfig(agent.agencyConfig, overrides[agent.id], {
        canManage: canManage.has(agent.id),
        visibility: agent.visibility,
        workspaceId: agent.workspaceId,
      }),
    );
    if (deviceId) bindings[agent.id] = deviceId;
  }
  return bindings;
};

/**
 * The effective device of many agents for the caller in one pass — the batched
 * counterpart of {@link loadDeviceBoundAgents}, for surfaces that decorate a
 * list of agents and must not fetch each agent's config separately.
 */
export const loadAgentDeviceBindings = async ({
  agentIds,
  db,
  userId,
  workspaceId,
}: {
  agentIds: string[];
  db: LobeChatDatabase;
  userId: string;
  workspaceId?: string;
}): Promise<Record<string, string>> => {
  const overrides = workspaceId
    ? ((await new WorkspaceUserSettingsModel(db, userId, workspaceId).getPreference())
        .agentDeviceOverrides ?? {})
    : {};
  const candidates = await new AgentModel(db, userId, workspaceId).queryAgencyRoutingByIds(
    agentIds,
  );
  const canManage = await resolveManagedAgentIds({ candidates, db, overrides, userId });

  return selectAgentDeviceBindings(candidates, { canManage, overrides });
};
