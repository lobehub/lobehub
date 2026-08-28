import { isDesktop } from '@lobechat/const';
import type { LobeAgentAgencyConfig } from '@lobechat/types';
import { resolveAgentAgencyConfig } from '@lobechat/types';

import { getRuntimeCanManageAgent } from '@/helpers/agentManagementAccess';
import { isLocalSandboxEnabled, resolveExecutionTarget } from '@/helpers/executionTarget';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

export interface ClientLocalSandboxDecision {
  /** Confine this command (writes scoped to the working directory). */
  localSandbox: boolean;
  /** …and let it reach the package-registry allowlist. */
  localSandboxNetwork: boolean;
}

const unfenced: ClientLocalSandboxDecision = { localSandbox: false, localSandboxNetwork: false };

const isFenced = (agencyConfig: LobeAgentAgencyConfig | undefined): boolean =>
  isLocalSandboxEnabled(
    agencyConfig,
    resolveExecutionTarget(agencyConfig, {
      clientExecutionAvailable: true,
      isHetero: !!agencyConfig?.heterogeneousProvider?.type,
    }),
  );

/**
 * Whether an in-process desktop command must be sandboxed.
 *
 * The gateway path resolves this on the server (`ToolExecutionContext.localSandbox`),
 * but a desktop run that executes in-process never reaches the server runtime —
 * without this the user could pick "Local Sandbox" and get an unfenced command
 * with no indication anything was skipped. Both paths converge on
 * `isLocalSandboxEnabled` so they cannot disagree about which runs are fenced.
 *
 * Non-reactive by necessity (executors are plain callbacks, not components), so
 * it reads the two stores `useEffectiveAgencyConfig` composes: the shared
 * `agents.agencyConfig` plus this member's `agentDeviceOverrides` entry, merged
 * through the same `resolveAgentAgencyConfig` the picker and server dispatch
 * use — a plain `resolveAgencyConfig` would apply an override on a personal
 * Agent, where every other layer ignores it.
 *
 * `canManage` follows the actual management decision the picker resolved
 * (`getRuntimeCanManageAgent`, published by `useAgentManagementAccess`), so a
 * fixed-policy manager's Local Sandbox pick — network allowance included — is
 * honored the way their picker rendered it. The cache can still be cold when
 * an executor fires before any dispatch resolved access; the fence itself
 * therefore stays conservative — if EITHER role reading says fenced, the
 * command is fenced. Over-fencing fails loudly and recoverably — a write
 * outside the working directory is refused with a clear error — while
 * under-fencing would run unconfined beneath a chip that claims otherwise,
 * which is the one outcome this whole feature exists to prevent. The network
 * relaxation, by contrast, follows only the resolved reading: it widens what
 * a fenced command can reach, so it must match what the user's picker showed.
 */
export const resolveClientLocalSandbox = (agentId?: string): ClientLocalSandboxDecision => {
  if (!isDesktop || !agentId) return unfenced;

  const state = useAgentStore.getState();
  const sharedAgencyConfig = agentByIdSelectors.getAgencyConfigById(agentId)(state);
  const agent = agentByIdSelectors.getAgentById(agentId)(state);
  const userState = useUserStore.getState();
  const override = userState.workspaceUserPreference.agentDeviceOverrides?.[agentId];

  const canManage = getRuntimeCanManageAgent({
    agentId,
    agentUserId: agent?.userId,
    currentUserId: userProfileSelectors.userId(userState),
  });
  const context = { visibility: agent?.visibility, workspaceId: agent?.workspaceId ?? undefined };
  const resolved = resolveAgentAgencyConfig(sharedAgencyConfig, override, {
    ...context,
    canManage,
  });
  const otherRole = resolveAgentAgencyConfig(sharedAgencyConfig, override, {
    ...context,
    canManage: !canManage,
  });

  const fenced = isFenced(resolved) || isFenced(otherRole);
  if (!fenced) return unfenced;

  return {
    localSandbox: true,
    localSandboxNetwork: resolved?.localSandboxNetwork === true,
  };
};
