'use client';

import type { AgentModelSelectionPolicy, AgentTopicSharePolicy } from '@lobechat/types';

import { useAgentSelectionPolicies } from '@/features/ResourcePermission/useAgentSelectionPolicies';
import { useResourcePermission } from '@/features/ResourcePermission/useResourcePermission';
import type { ResourceAccessLevel } from '@/services/resourcePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

export interface AgentPermissionState {
  accessError: unknown;
  accessLevel?: ResourceAccessLevel;
  accessLoading: boolean;
  /** Only the creator or a workspace owner may change member selection policies. */
  canEditConfig: boolean;
  /**
   * Whether the viewer may write the three policy rows. Narrower than
   * {@link AgentPermissionState.canEditConfig} — see
   * `AgentSelectionPoliciesState.canEditPolicies`.
   */
  canEditPolicies: boolean;
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
  setTopicSharePolicy: (policy: AgentTopicSharePolicy) => void;
  /** Whether members may publish share links for the topics held here. */
  topicSharePolicy: AgentTopicSharePolicy;
}

/**
 * View model of the Agent Permission page: the member access level plus the
 * agent's own Editable settings (shared with the Agent Group page through
 * {@link useAgentSelectionPolicies}).
 *
 * A private agent still shows every control: all of them are the same promise
 * about what happens once it reaches the workspace.
 */
export const useAgentPermission = (agentId: string): AgentPermissionState => {
  const agent = useAgentStore(agentByIdSelectors.getAgentById(agentId));

  const isWorkspaceAgent = !!agent?.workspaceId;
  const isPrivate = agent?.visibility === 'private';

  const {
    data: access,
    error: accessError,
    isLoading: accessLoading,
    mutate: retryAccess,
    // Settable while private too: the server stores the level and the publish
    // paths read it back, so it is the same configure-ahead-of-sharing promise
    // the policies below make.
    setAccessLevel,
  } = useResourcePermission('agent', isWorkspaceAgent ? agentId : undefined);

  const policies = useAgentSelectionPolicies(agentId);

  return {
    ...policies,
    accessError,
    accessLevel: access?.accessLevel,
    accessLoading,
    canEditConfig: access?.canManage === true,
    canManageAccess: access?.canManage === true,
    isPrivate,
    isWorkspaceAgent,
    retryAccess: () => void retryAccess(),
    setAccessLevel: (level) => void setAccessLevel(level),
  };
};
