import { isDesktop } from '@lobechat/const';
import type { DeviceExecutionTarget, LobeAgentAgencyConfig } from '@lobechat/types';

import { isApiAuthBlockedOnTarget } from '@/features/HeterogeneousAgent/apiMode';
import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';

import { type HeteroProfilePanel, resolveHeteroProfilePanel } from './heteroProfilePanel';

export interface ProfileExecutionTarget {
  /** Shared config merged with the caller's own override, without a topic binding. */
  agencyConfig: LobeAgentAgencyConfig | undefined;
  /** The gateway-routed device, set only when `target` is `device`. */
  deviceId?: string;
  /** API-mode auth cannot run on `target`; dispatch rejects it off this desktop. */
  isApiAuthBlocked: boolean;
  /** The caller's own pick applies instead of the shared default. */
  isOverridden: boolean;
  /** The workspace preference is still loading, so `target` may still flip. */
  isPending: boolean;
  /** False when a fixed workspace policy keeps this member on the shared target. */
  isSelectable: boolean;
  /** The configuration panel for that environment. */
  panel: HeteroProfilePanel;
  target: DeviceExecutionTarget;
}

/**
 * Where the current caller's NEW topics of a heterogeneous agent run.
 *
 * The profile's environment picker and its CLI status panel both read this, so
 * the panel always describes the machine the picker names — never the client
 * the profile happens to be open on.
 */
export const useProfileExecutionTarget = (agentId: string): ProfileExecutionTarget => {
  const {
    agencyConfig,
    canSelectExecutionTarget,
    executionTargetOverridden,
    isPreferenceLoading,
    workspaceScoped,
  } = useEffectiveAgencyConfig(agentId, { topicId: null });
  const target = resolveExecutionTarget(agencyConfig, {
    clientExecutionAvailable: isDesktop,
    isHetero: true,
    workspaceScoped,
  });

  const deviceId = target === 'device' ? agencyConfig?.boundDeviceId : undefined;
  const panel = resolveHeteroProfilePanel({
    deviceId,
    providerType: agencyConfig?.heterogeneousProvider?.type,
    target,
  });

  return {
    agencyConfig,
    deviceId,
    // A bundled runtime has its own provider-key auth, not the CLI API mode.
    isApiAuthBlocked:
      panel.kind !== 'runtime' &&
      isApiAuthBlockedOnTarget(agencyConfig?.heterogeneousProvider?.authMode, target),
    isOverridden: executionTargetOverridden,
    isPending: isPreferenceLoading,
    isSelectable: canSelectExecutionTarget,
    panel,
    target,
  };
};
