import { type WorkspaceConnectorMemberManage } from '@lobechat/types';

import { useResourceManageable } from '@/hooks/useResourceManageable';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { lambdaClient } from '@/libs/trpc/client';

/** Workspace-dimensioned by `useClientDataSWR`, so each workspace keeps its own entry. */
export const CONNECTOR_MANAGE_POLICY_SWR_KEY = 'connector/managePolicy';

export interface ConnectorManagePolicy {
  /** Owners and admins choose whether members may maintain shared connectors. */
  canEditPolicy: boolean;
  /** Whether the viewer may connect, re-authorize, sync or remove shared connectors. */
  canManage: boolean;
  memberManage: WorkspaceConnectorMemberManage;
}

export const useConnectorManagePolicy = () =>
  useClientDataSWR<ConnectorManagePolicy>([CONNECTOR_MANAGE_POLICY_SWR_KEY], () =>
    lambdaClient.connector.getManagePolicy.query(),
  );

/** Refetch the policy, e.g. after a 403 shows the cached one is stale. */
export const refreshConnectorManagePolicy = () =>
  mutate((key: unknown) => Array.isArray(key) && key[0] === CONNECTOR_MANAGE_POLICY_SWR_KEY);

export const updateConnectorManagePolicy = async (memberManage: WorkspaceConnectorMemberManage) => {
  await lambdaClient.connector.updateManagePolicy.mutate({ memberManage });
  await refreshConnectorManagePolicy();
};

export interface ConnectorManageable {
  /** Maintenance writes: connect, re-authorize, sync, reset permissions, remove. */
  canManage: boolean;
  /**
   * Writes that reach the stored credentials (edit form, agent binding). Shared
   * connectors are co-maintained, but another member's secrets stay with their
   * creator and the workspace owner.
   */
  canManageCredentials: boolean;
  /** The workspace policy, not the row's creator, is what blocks the viewer. */
  restrictedByPolicy: boolean;
}

/**
 * Client mirror of the server's connector manage gates
 * (`assertConnectorMaintainable` / `assertConnectorCredentialsManageable`).
 * Until the policy loads it assumes the default (members may maintain); the
 * server still enforces, and a rejected write shows its reason on the row.
 */
export const useConnectorManageable = (connector?: {
  agentId?: string | null;
  userId?: string | null;
}): ConnectorManageable => {
  const { data: policy } = useConnectorManagePolicy();
  const isCreatorOrOwner = useResourceManageable(connector?.userId);

  // Agent-scoped rows belong to that agent's setup and keep the creator rule.
  if (connector?.agentId)
    return {
      canManage: isCreatorOrOwner,
      canManageCredentials: isCreatorOrOwner,
      restrictedByPolicy: false,
    };

  const canManage = policy?.canManage ?? true;
  return {
    canManage,
    canManageCredentials: canManage && isCreatorOrOwner,
    restrictedByPolicy: !canManage,
  };
};
