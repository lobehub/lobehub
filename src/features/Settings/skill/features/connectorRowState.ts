import { useResourceManageable } from '@/hooks/useResourceManageable';
import { useToolStore } from '@/store/tool';
import { connectorSelectors } from '@/store/tool/slices/connector';

/**
 * Row-level manage gate of a workspace-shared connection, mirroring the server's
 * `assertComposioRowManageable`: only its creator or a workspace owner may
 * (re)connect or remove it. Everyone else gets the creator's name, so the row can
 * say whom to ask instead of offering a button that fails with a 403.
 */
export const useConnectorManageGate = (
  identifier: string,
): { canManage: boolean; creatorName?: string } => {
  const connector = useToolStore(connectorSelectors.connectorByIdentifier(identifier));
  const canManage = useResourceManageable(connector?.userId);

  return {
    canManage,
    creatorName: canManage ? undefined : (connector?.authorizedByName ?? undefined),
  };
};
