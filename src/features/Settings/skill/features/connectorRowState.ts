import { useResourceManageable } from '@/hooks/useResourceManageable';
import { useToolStore } from '@/store/tool';
import { connectorSelectors } from '@/store/tool/slices/connector';
import { type ConnectorActionError } from '@/utils/connectorActionError';

/**
 * Whether a row's stored failure is settled by the connection being active: an
 * earlier connect failure is (e.g. a slow OAuth that later succeeded), but a
 * failed remove leaves the row active on purpose, so its reason must stay.
 */
export const isSettledByConnection = (
  isConnected: boolean,
  error: ConnectorActionError | undefined,
): boolean => isConnected && error?.action === 'connect';

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
