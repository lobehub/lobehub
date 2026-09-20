import { isDesktop } from '@lobechat/const';
import type { LobeAgentAgencyConfig } from '@lobechat/types';

import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useIsGatewayModeEnabled } from '@/helpers/gatewayMode';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

/**
 * Which workspace controls sit next to the device switcher, in order:
 *
 * - `workingDirectory` — directory picker + git status, for a run on this
 *   machine or on a bound device
 * - `cloudRepo`        — cloud repo switcher (web has no local filesystem)
 * - `sandbox`          — the cloud sandbox's own working directory: a throwaway
 *   box or an environment instance
 *
 * An empty list means the run has no browsable workspace here. One resolver
 * for the whole slot, so what may appear together is decided in one place: the
 * sandbox case used to render outside this and gate itself, which left "these
 * never both appear" as a claim about two independent conditions rather than
 * something the shape of the code enforces. The one pair that does appear
 * together is a heterogeneous run in the cloud sandbox — which repository, and
 * which instance it runs in, are two different questions.
 */
export type WorkspaceSurface = 'cloudRepo' | 'sandbox' | 'workingDirectory';

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
}: ResolveWorkspaceSurfaceParams): WorkspaceSurface[] => {
  const effectiveTarget = resolveExecutionTarget(agencyConfig, {
    clientExecutionAvailable,
    deviceRoutingAvailable,
    isHetero,
    workspaceScoped,
  });

  // Remote device runs get the device-scoped picker, whatever else is set.
  if (effectiveTarget === 'device' && !!agencyConfig?.boundDeviceId) return ['workingDirectory'];

  // Web has no local filesystem — cloud / heterogeneous agents browse the repo
  // through the cloud repo switcher instead.
  if (!clientExecutionAvailable) {
    // A heterogeneous run in the cloud sandbox gets both: the repository it
    // works on, and the instance it keeps its files in. The repo switcher comes
    // first because it was there first. A forced-on workspace that is not a
    // sandbox run has only the repository to talk about.
    if (isHetero || alwaysShowWorkspace) {
      return effectiveTarget === 'sandbox' ? ['cloudRepo', 'sandbox'] : ['cloudRepo'];
    }

    return effectiveTarget === 'sandbox' ? ['sandbox'] : [];
  }

  // Desktop: local working directory + git branch / diff / PR. Shown when the
  // run is local, or always for heterogeneous agents (they always have a cwd).
  if (alwaysShowWorkspace || effectiveTarget === 'local') return ['workingDirectory'];

  // Last, so no run that already has a surface loses it: a sandbox target is
  // also what a web `local` pick coerces to. This claims only the case that had
  // nothing — a plain run in the cloud sandbox, whose working directory is the
  // instance it runs in.
  //
  // Whether the member may actually use one (lab flag, entitlement) is the
  // section's own business; this resolver answers about targets.
  if (effectiveTarget === 'sandbox') return ['sandbox'];

  return [];
};

/**
 * The workspace surfaces for an agent, resolved from the EFFECTIVE execution
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
): WorkspaceSurface[] => {
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
