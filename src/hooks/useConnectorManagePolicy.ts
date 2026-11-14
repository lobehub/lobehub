import { useCallback } from 'react';

import { useResourceManageable, useResourceManageableChecker } from '@/hooks/useResourceManageable';
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

interface ConnectorManageRow {
  agentId?: string | null;
  userId?: string | null;
}

const resolveConnectorManageable = (
  connector: ConnectorManageRow | undefined,
  policy: ConnectorManagePolicy | undefined,
  policyError: unknown,
  isCreatorOrOwner: boolean,
): ConnectorManageable => {
  // Agent-scoped rows belong to that agent's setup and keep the creator rule.
  if (connector?.agentId)
    return {
      canManage: isCreatorOrOwner,
      canManageCredentials: isCreatorOrOwner,
      isPending: false,
      restrictedByPolicy: false,
    };

  if (!policy && !policyError)
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

/**
 * Client mirror of the server's connector manage gates
 * (`assertConnectorMaintainable` / `assertConnectorCredentialsManageable`).
 * Actions are enabled only once the server-computed policy says they are
 * allowed; a restricted viewer gets disabled controls with the reason on hover.
 */
export const useConnectorManageable = (connector?: ConnectorManageRow): ConnectorManageable => {
  const { data: policy, error } = useConnectorManagePolicy();
  const isCreatorOrOwner = useResourceManageable(connector?.userId);

  return resolveConnectorManageable(connector, policy, error, isCreatorOrOwner);
};

/**
 * Callback variant of {@link useConnectorManageable} for lists that check many
 * connectors under one hook call, such as the chat input's tool picker.
 */
export const useConnectorManageableChecker = (): ((
  connector: ConnectorManageRow,
) => ConnectorManageable) => {
  const { data: policy, error } = useConnectorManagePolicy();
  const checkCreatorOrOwner = useResourceManageableChecker();

  return useCallback(
    (connector: ConnectorManageRow) =>
      resolveConnectorManageable(connector, policy, error, checkCreatorOrOwner(connector.userId)),
    [checkCreatorOrOwner, error, policy],
  );
};
