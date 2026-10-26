import { useConnectorManageable } from '@/hooks/useConnectorManagePolicy';
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
 * `assertComposioRowManageable`: members co-maintain shared connectors unless a
 * workspace owner or admin restricted it, in which case the row stays visible
 * with a disabled Connect and an "Ask an admin" entry instead of a button that
 * fails with a 403. While the policy loads (`pending`) controls stay disabled.
 */
export const useConnectorManageGate = (
  identifier: string,
): { access: 'allowed' | 'pending' | 'restricted' } => {
  const connector = useToolStore(connectorSelectors.connectorByIdentifier(identifier));
  const { canManage, isPending } = useConnectorManageable(connector);

  return { access: isPending ? 'pending' : canManage ? 'allowed' : 'restricted' };
};
