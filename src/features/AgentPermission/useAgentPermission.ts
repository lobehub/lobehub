'use client';

import type { AgentModelSelectionPolicy, LobeAgentAgencyConfig } from '@lobechat/types';
import { useCallback, useMemo } from 'react';

import { useDeviceList } from '@/features/DeviceManager/useDeviceList';
import {
  groupExecutionTargetDevices,
  resolveExecutionTargetSelection,
} from '@/features/ExecutionTargetPicker';
import { useResourcePermission } from '@/features/ResourcePermission/useResourcePermission';
import { isHeterogeneousSandboxExecutionAvailable } from '@/helpers/executionTarget';
import { usePermission } from '@/hooks/usePermission';
import type { ResourceAccessLevel } from '@/services/resourcePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

export interface AgentPermissionState {
  accessError: unknown;
  accessLevel?: ResourceAccessLevel;
  accessLoading: boolean;
  /** Role-level gate for the model / execution-environment policies. */
  canEditConfig: boolean;
  /** Members can be assigned a target only if one is actually resolvable. */
  canFixExecutionTarget: boolean;
  /** Only the creator or a workspace owner may re-level members. */
  canManageAccess: boolean;
  executionTargetPolicy: AgentModelSelectionPolicy;
  isPrivate: boolean;
  isWorkspaceAgent: boolean;
  modelPolicy: AgentModelSelectionPolicy;
  retryAccess: () => void;
  setAccessLevel: (level: ResourceAccessLevel) => void;
  setExecutionTargetPolicy: (policy: AgentModelSelectionPolicy) => void;
  setModelPolicy: (policy: AgentModelSelectionPolicy) => void;
}

/**
 * View model of the Agent Permission page.
 *
 * The stored policy is read directly rather than through
 * `resolveAgentModelSelectionPolicy`: that resolver answers "what happens at
 * run time", which collapses to `fixed` for a private agent — so a control
 * driven by it would look stuck on an agent whose author is configuring the
 * rules ahead of sharing. Here the author's *intent* is what's edited — which
 * is also why a private agent still shows every control: all of them are the
 * same promise about what happens once it reaches the workspace.
 */
export const useAgentPermission = (agentId: string): AgentPermissionState => {
  const { allowed: canEditContent } = usePermission('edit_own_content');
  const agent = useAgentStore(agentByIdSelectors.getAgentById(agentId));
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);

  const isWorkspaceAgent = !!agent?.workspaceId;
  const isPrivate = agent?.visibility === 'private';

  const {
    data: access,
    error: accessError,
    isLoading: accessLoading,
    mutate: retryAccess,
    setAccessLevel,
    // Settable while private too: the server stores the level and the publish
    // paths read it back, so it is the same configure-ahead-of-sharing promise
    // the policies below make.
  } = useResourcePermission('agent', isWorkspaceAgent ? agentId : undefined);

  const { data: devices } = useDeviceList();
  const publicWorkspaceDevices = useMemo(
    () => groupExecutionTargetDevices(devices).publicWorkspace,
    [devices],
  );

  const agencyConfig = agent?.agencyConfig;
  const heterogeneousType = agencyConfig?.heterogeneousProvider?.type;
  const executionSelection = resolveExecutionTargetSelection({
    boundDeviceId: agencyConfig?.boundDeviceId,
    configuredTarget: agencyConfig?.executionTarget,
    devices: publicWorkspaceDevices,
    isHeterogeneous: !!heterogeneousType,
  });

  const saveAgencyConfig = useCallback(
    (patch: Partial<LobeAgentAgencyConfig>) =>
      updateAgentConfigById(agentId, { agencyConfig: patch }),
    [agentId, updateAgentConfigById],
  );

  const setExecutionTargetPolicy = useCallback(
    (policy: AgentModelSelectionPolicy) => {
      if (policy === 'member') {
        void saveAgencyConfig({ executionTargetSelectionPolicy: 'member' });
        return;
      }
      // Fixing pins whatever is selected right now, so a run can't fall back to
      // a target the author never chose.
      if (!executionSelection) return;

      void saveAgencyConfig({
        ...(executionSelection.deviceId ? { boundDeviceId: executionSelection.deviceId } : {}),
        executionTarget: executionSelection.target,
        executionTargetSelectionPolicy: 'fixed',
      });
    },
    [executionSelection, saveAgencyConfig],
  );

  const setModelPolicy = useCallback(
    (policy: AgentModelSelectionPolicy) => void saveAgencyConfig({ modelSelectionPolicy: policy }),
    [saveAgencyConfig],
  );

  return {
    accessError,
    accessLevel: access?.accessLevel,
    accessLoading,
    canEditConfig: canEditContent,
    canFixExecutionTarget:
      !!executionSelection &&
      (executionSelection.target !== 'sandbox' ||
        isHeterogeneousSandboxExecutionAvailable(heterogeneousType)),
    canManageAccess: access?.canManage === true,
    executionTargetPolicy: agencyConfig?.executionTargetSelectionPolicy ?? 'member',
    isPrivate,
    isWorkspaceAgent,
    modelPolicy: agencyConfig?.modelSelectionPolicy ?? 'member',
    retryAccess: () => void retryAccess(),
    setAccessLevel: (level) => void setAccessLevel(level),
    setExecutionTargetPolicy,
    setModelPolicy,
  };
};
