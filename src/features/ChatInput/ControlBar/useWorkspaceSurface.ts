import { isDesktop } from '@lobechat/const';
import type { LobeAgentAgencyConfig } from '@lobechat/types';

import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useIsGatewayModeEnabled } from '@/helpers/gatewayMode';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

/**
 * Which workspace control sits next to the device switcher:
 *
 * - `workingDirectory` — directory picker + git status, for a run on this
 *   machine or on a bound device
 * - `cloudRepo`        — cloud repo switcher (web has no local filesystem)
 * - `sandbox`          — the cloud sandbox's own working directory: a throwaway
 *   box, the workspace root, or an environment instance
 * - `undefined`        — nothing; the run has no browsable workspace here
 *
 * One slot, one answer. The sandbox case used to render outside this switch and
 * gate itself, which left "these never both appear" as a claim about two
 * independent conditions rather than something the shape of the code enforces.
 */
export type WorkspaceSurface = 'cloudRepo' | 'sandbox' | 'workingDirectory' | undefined;

export interface ResolveWorkspaceSurfaceParams {
  /** The EFFECTIVE config — shared row merged with this member's device override. */
  agencyConfig: LobeAgentAgencyConfig | undefined;
  /** Heterogeneous agents always run inside a working directory. */
  alwaysShowWorkspace: boolean;
  /** See `ResolveExecutionTargetOptions.clientExecutionAvailable` (`isDesktop` in the UI). */
  clientExecutionAvailable: boolean;
  deviceRoutingAvailable: boolean;
  isHetero: boolean;
  /** See `UseEffectiveAgencyConfigResult.workspaceScoped`. */
  workspaceScoped: boolean;
}

export const resolveWorkspaceSurface = ({
  agencyConfig,
  alwaysShowWorkspace,
  clientExecutionAvailable,
  deviceRoutingAvailable,
  isHetero,
  workspaceScoped,
}: ResolveWorkspaceSurfaceParams): WorkspaceSurface => {
  const effectiveTarget = resolveExecutionTarget(agencyConfig, {
    clientExecutionAvailable,
    deviceRoutingAvailable,
    isHetero,
    workspaceScoped,
  });

  // Remote device runs get the device-scoped picker, whatever else is set.
  if (effectiveTarget === 'device' && !!agencyConfig?.boundDeviceId) return 'workingDirectory';

  // Web has no local filesystem — cloud / heterogeneous agents browse the repo
  // through the cloud repo switcher instead.
  if (!clientExecutionAvailable) {
    // Both are relevant to such a run — which repository, and which instance it
    // runs in — and the repo switcher is the one that was already there, so the
    // sandbox claims only what this branch used to leave with nothing.
    if (isHetero || alwaysShowWorkspace) return 'cloudRepo';

    return effectiveTarget === 'sandbox' ? 'sandbox' : undefined;
  }

  // Desktop: local working directory + git branch / diff / PR. Shown when the
  // run is local, or always for heterogeneous agents (they always have a cwd).
  if (alwaysShowWorkspace || effectiveTarget === 'local') return 'workingDirectory';

  // Last, so no run that already has a surface loses it: a sandbox target is
  // also what a web `local` pick coerces to, and a heterogeneous agent on that
  // same target browses its repository through `cloudRepo`. This claims only
  // the case that had nothing — a plain run in the cloud sandbox, whose
  // working directory is the instance it runs in.
  //
  // Whether the member may actually use one (lab flag, entitlement) is the
  // section's own business; this resolver answers about targets.
  if (effectiveTarget === 'sandbox') return 'sandbox';

  return undefined;
};

/**
 * The workspace surface for an agent, resolved from the EFFECTIVE execution
 * target (shared row + this member's per-user device override).
 *
 * Deliberately not `chatConfigByIdSelectors.getRuntimeModeById`: that store
 * selector only sees the workspace-shared row and treats every workspace agent
 * as workspace-scoped, so a member's "Local device" pick — which lives solely
 * in `agentDeviceOverrides` — never resolves to `local` there. The device chip
 * would say "Local device" while the directory picker stayed hidden.
 */
export const useWorkspaceSurface = (
  agentId: string,
  alwaysShowWorkspace = false,
): WorkspaceSurface => {
  const isHetero = useAgentStore(agentByIdSelectors.isAgentHeterogeneousById(agentId));
  const { agencyConfig, workspaceScoped } = useEffectiveAgencyConfig(agentId);
  const deviceRoutingAvailable = useIsGatewayModeEnabled(agentId);

  return resolveWorkspaceSurface({
    agencyConfig,
    alwaysShowWorkspace,
    clientExecutionAvailable: isDesktop,
    deviceRoutingAvailable,
    isHetero,
    workspaceScoped,
  });
};
