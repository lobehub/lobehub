import { isDesktop } from '@lobechat/const';
import type { LobeAgentAgencyConfig } from '@lobechat/types';
import { resolveAgentAgencyConfig } from '@lobechat/types';

import { isLocalSandboxEnabled, resolveExecutionTarget } from '@/helpers/executionTarget';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';

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
 * use — a plain `resolveAgencyConfig` would apply a member override on a
 * private Agent, where every other layer ignores it.
 *
 * One input is genuinely unavailable here: `canManage` comes from a permission
 * hook with no store to read synchronously. It only changes the answer for an
 * author/admin of a *public workspace* Agent carrying a stale member override,
 * so rather than guess, both readings are computed and a disagreement resolves
 * toward fencing. Over-fencing fails loudly and recoverably — a write outside
 * the working directory is refused with a clear error — while under-fencing
 * would run unconfined beneath a chip that claims otherwise, which is the one
 * outcome this whole feature exists to prevent.
 */
export const resolveClientLocalSandbox = (agentId?: string): ClientLocalSandboxDecision => {
  if (!isDesktop || !agentId) return unfenced;

  const state = useAgentStore.getState();
  const sharedAgencyConfig = agentByIdSelectors.getAgencyConfigById(agentId)(state);
  const agent = agentByIdSelectors.getAgentById(agentId)(state);
  const override = useUserStore.getState().workspaceUserPreference.agentDeviceOverrides?.[agentId];

  const context = { visibility: agent?.visibility, workspaceId: agent?.workspaceId ?? undefined };
  const asMember = resolveAgentAgencyConfig(sharedAgencyConfig, override, context);
  const asManager = resolveAgentAgencyConfig(sharedAgencyConfig, override, {
    ...context,
    canManage: true,
  });

  const fenced = isFenced(asMember) || isFenced(asManager);
  if (!fenced) return unfenced;

  // Network is a relaxation of the fence, so it needs agreement rather than
  // either-or: opening the allowlist on the strength of a reading the user may
  // never have seen would widen what a fenced command can reach.
  return {
    localSandbox: true,
    localSandboxNetwork:
      asMember?.localSandboxNetwork === true && asManager?.localSandboxNetwork === true,
  };
};
