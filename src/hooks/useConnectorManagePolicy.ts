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
  /**
   * The policy has not loaded yet: actions stay disabled without a permission
   * hint, so a button is never clickable before we know the server allows it.
   */
  isPending: boolean;
  /** The workspace policy, not the row's creator, is what blocks the viewer. */
  restrictedByPolicy: boolean;
}

/**
 * Client mirror of the server's connector manage gates
 * (`assertConnectorMaintainable` / `assertConnectorCredentialsManageable`).
 * Actions are enabled only once the server-computed policy says they are
 * allowed; a restricted viewer gets disabled controls with the reason on hover.
 */
export const useConnectorManageable = (connector?: {
  agentId?: string | null;
  userId?: string | null;
}): ConnectorManageable => {
  const { data: policy, error } = useConnectorManagePolicy();
  const isCreatorOrOwner = useResourceManageable(connector?.userId);

  // Agent-scoped rows belong to that agent's setup and keep the creator rule.
  if (connector?.agentId)
    return {
      canManage: isCreatorOrOwner,
      canManageCredentials: isCreatorOrOwner,
      isPending: false,
      restrictedByPolicy: false,
    };

  if (!policy && !error)
    return {
      canManage: false,
      canManageCredentials: false,
      isPending: true,
      restrictedByPolicy: false,
    };

  // A failed policy read must not lock every connector: fall back to the
  // default and let the server decide (a 403 refetches the policy).
  const canManage = policy?.canManage ?? true;
  return {
    canManage,
    canManageCredentials: canManage && isCreatorOrOwner,
    isPending: false,
    restrictedByPolicy: !canManage,
  };
};
