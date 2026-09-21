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
 * - `undefined`        — nothing; the run has no browsable workspace here
 */
export type WorkspaceSurface = 'cloudRepo' | 'workingDirectory' | undefined;

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
    return isHetero || alwaysShowWorkspace ? 'cloudRepo' : undefined;
  }

  // Desktop: local working directory + git branch / diff / PR. Shown when the
  // run is local, or always for heterogeneous agents (they always have a cwd).
  if (alwaysShowWorkspace || effectiveTarget === 'local') return 'workingDirectory';

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
