'use client';

import type {
  AgentModelSelectionPolicy,
  AgentTopicSharePolicy,
  LobeAgentAgencyConfig,
} from '@lobechat/types';
import { useCallback, useMemo } from 'react';

import { useDeviceList } from '@/features/DeviceManager/useDeviceList';
import {
  groupExecutionTargetDevices,
  resolveExecutionTargetSelection,
} from '@/features/ExecutionTargetPicker';
import { isHeterogeneousSandboxExecutionAvailable } from '@/helpers/executionTarget';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

export interface AgentSelectionPoliciesState {
  /**
   * Whether the viewer may write these policies at all.
   *
   * Deliberately narrower than the Permission page's `canEditConfig`: a
   * workspace Admin holds `agent:update:all` and so may edit the agent, but the
   * server strips every policy key unless the caller is the agent's creator or
   * the workspace owner — and it strips them from an otherwise *successful*
   * mutation. An enabled control would therefore accept the choice, report no
   * error, and silently discard it.
   */
  canEditPolicies: boolean;
  /** Members can be assigned a target only if one is actually resolvable. */
  canFixExecutionTarget: boolean;
  executionTargetPolicy: AgentModelSelectionPolicy;
  modelPolicy: AgentModelSelectionPolicy;
  setExecutionTargetPolicy: (policy: AgentModelSelectionPolicy) => void;
  setModelPolicy: (policy: AgentModelSelectionPolicy) => void;
  setTopicSharePolicy: (policy: AgentTopicSharePolicy) => void;
  topicSharePolicy: AgentTopicSharePolicy;
}

/**
 * The member-facing policies of a Permission page: what a workspace member may
 * switch for their own conversations / runs with ONE agent, plus whether they
 * may publish that agent's topics as share links.
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
  // Mirrors the server's policy-write gate. The workspace `owner` role is
  // bound to `workspaces.primaryOwnerId` (a second 'owner' membership resolves
  // to 'admin'), so this is the same single user the server checks; personal
  // mode reports allowed, which is right — there are no members to govern.
  const { allowed: isWorkspaceOwner } = usePermission('edit_others_content');
  const viewerId = useUserStore(userProfileSelectors.userId);

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

  const setTopicSharePolicy = useCallback(
    (policy: AgentTopicSharePolicy) => void saveAgencyConfig({ topicSharePolicy: policy }),
    [saveAgencyConfig],
  );

  return {
    // An unresolved agent leaves the controls disabled rather than enabled:
    // the values shown above come from the same row, so there is nothing
    // meaningful to edit until it loads.
    canEditPolicies: isWorkspaceOwner || (!!agent?.userId && agent.userId === viewerId),
    canFixExecutionTarget:
      !!executionSelection &&
      (executionSelection.target !== 'sandbox' ||
        isHeterogeneousSandboxExecutionAvailable(heterogeneousType)),
    executionTargetPolicy: agencyConfig?.executionTargetSelectionPolicy ?? 'member',
    modelPolicy: agencyConfig?.modelSelectionPolicy ?? 'member',
    setExecutionTargetPolicy,
    setModelPolicy,
    setTopicSharePolicy,
    topicSharePolicy: agencyConfig?.topicSharePolicy ?? 'member',
  };
};
