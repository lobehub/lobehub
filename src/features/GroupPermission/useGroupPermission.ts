'use client';

import type { AgentModelSelectionPolicy } from '@lobechat/types';

import { useAgentSelectionPolicies } from '@/features/ResourcePermission/useAgentSelectionPolicies';
import { useResourcePermission } from '@/features/ResourcePermission/useResourcePermission';
import { usePermission } from '@/hooks/usePermission';
import type { ResourceAccessLevel } from '@/services/resourcePermission';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

export interface GroupPermissionState {
  accessError: unknown;
  accessLevel?: ResourceAccessLevel;
  accessLoading: boolean;
  /** Role-level gate for the model / execution-environment policies. */
  canEditConfig: boolean;
  /** Fixing needs an execution environment resolvable on the supervisor. */
  canFixExecutionTarget: boolean;
  /** Only the creator or a workspace owner may re-level members. */
  canManageAccess: boolean;
  executionTargetPolicy: AgentModelSelectionPolicy;
  /** No supervisor row yet — the Editable settings have nothing to write to. */
  hasSupervisor: boolean;
  isPrivate: boolean;
  isWorkspaceGroup: boolean;
  modelPolicy: AgentModelSelectionPolicy;
  retryAccess: () => void;
  setAccessLevel: (level: ResourceAccessLevel) => void;
  setExecutionTargetPolicy: (policy: AgentModelSelectionPolicy) => void;
  setModelPolicy: (policy: AgentModelSelectionPolicy) => void;
}

/**
 * View model of the Agent Group Permission page.
 *
 * The two halves have different subjects, which is the whole reason this page
 * can exist at all:
 *
 * - **Access level** is about the *group* resource — who may open and edit it.
 *   The server cascades it to the agents the group owns.
 * - **Editable settings** are about the *supervisor agent*, because a group
 *   conversation is a conversation with the supervisor: `useGroupContext`
 *   resolves the chat context's `agentId` to `supervisorAgentId`, so the group
 *   chat's model / execution-environment switcher reads exactly that row's
 *   policies. Deliberately NOT fanned out to the member agents — a workspace
 *   member has no per-member switcher to gate, and writing a `fixed` policy
 *   onto an agent with no execution target is rejected by `AgentModel`.
 *
 * The group store hydrates the supervisor into `agentMap` whenever group detail
 * loads (`agentGroup/action.ts`), so the shared agent hook has its row here.
 */
export const useGroupPermission = (groupId: string): GroupPermissionState => {
  const { allowed: canEditContent } = usePermission('edit_own_content');
  const group = useAgentGroupStore(agentGroupSelectors.getGroupById(groupId));

  const isWorkspaceGroup = !!group?.workspaceId;
  const isPrivate = group?.visibility === 'private';
  const supervisorAgentId = group?.supervisorAgentId;

  const {
    data: access,
    error: accessError,
    isLoading: accessLoading,
    mutate: retryAccess,
    // Settable while private too: the server stores the level and the publish
    // path reads it back, so the creator can decide ahead of sharing.
    setAccessLevel,
  } = useResourcePermission('agentGroup', isWorkspaceGroup ? groupId : undefined);

  const policies = useAgentSelectionPolicies(supervisorAgentId ?? '');

  return {
    ...policies,
    accessError,
    accessLevel: access?.accessLevel,
    accessLoading,
    canEditConfig: canEditContent,
    canManageAccess: access?.canManage === true,
    hasSupervisor: !!supervisorAgentId,
    isPrivate,
    isWorkspaceGroup,
    retryAccess: () => void retryAccess(),
    setAccessLevel: (level) => void setAccessLevel(level),
  };
};
