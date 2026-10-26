import { useResourceManageable } from '@/hooks/useResourceManageable';
import { useClientDataSWR } from '@/libs/swr';
import {
  CONNECTOR_MANAGE_POLICY_SWR_KEY,
  type ConnectorManagePolicy,
  getConnectorManagePolicy,
} from '@/services/connectorManagePolicy';

export const useConnectorManagePolicy = () =>
  useClientDataSWR<ConnectorManagePolicy>(
    [CONNECTOR_MANAGE_POLICY_SWR_KEY],
    getConnectorManagePolicy,
  );

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
