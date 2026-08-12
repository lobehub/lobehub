'use client';

import type { AgentModelSelectionPolicy, LobeAgentAgencyConfig } from '@lobechat/types';
import { useCallback, useMemo } from 'react';

import { useDeviceList } from '@/features/DeviceManager/useDeviceList';
import {
  groupExecutionTargetDevices,
  resolveExecutionTargetSelection,
} from '@/features/ExecutionTargetPicker';
import { isHeterogeneousSandboxExecutionAvailable } from '@/helpers/executionTarget';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

export interface AgentSelectionPoliciesState {
  /** Members can be assigned a target only if one is actually resolvable. */
  canFixExecutionTarget: boolean;
  executionTargetPolicy: AgentModelSelectionPolicy;
  modelPolicy: AgentModelSelectionPolicy;
  setExecutionTargetPolicy: (policy: AgentModelSelectionPolicy) => void;
  setModelPolicy: (policy: AgentModelSelectionPolicy) => void;
}

/**
 * The "Editable settings" half of a Permission page: what a workspace member
 * may switch for their own conversations / runs with ONE agent.
 *
 * Shared by the Agent page and the Agent Group page, because a group's
 * conversation *is* a conversation with its supervisor agent — the group chat
 * input resolves its `agentId` to `supervisorAgentId`
 * (`useGroupContext`), so these policies are read off that one row in both
 * cases. Nothing here is group-aware; the caller decides which agent it means.
 *
 * The stored policy is read directly rather than through
 * `resolveAgentModelSelectionPolicy`: that resolver answers "what happens at
 * run time", which collapses to `fixed` for a private agent — so a control
 * driven by it would look stuck while its author configures the rules ahead of
 * sharing. What is edited here is the author's *intent*.
 */
export const useAgentSelectionPolicies = (agentId: string): AgentSelectionPoliciesState => {
  const agent = useAgentStore(agentByIdSelectors.getAgentById(agentId));
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);

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
    canFixExecutionTarget:
      !!executionSelection &&
      (executionSelection.target !== 'sandbox' ||
        isHeterogeneousSandboxExecutionAvailable(heterogeneousType)),
    executionTargetPolicy: agencyConfig?.executionTargetSelectionPolicy ?? 'member',
    modelPolicy: agencyConfig?.modelSelectionPolicy ?? 'member',
    setExecutionTargetPolicy,
    setModelPolicy,
  };
};
