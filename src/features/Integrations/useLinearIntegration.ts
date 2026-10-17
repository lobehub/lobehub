import useSWR from 'swr';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { linearService } from '@/services/linear';

import { linearKeys } from './Linear/swrKeys';

/**
 * Everything the Linear integration surfaces need, shared by the overview
 * card and the detail page. `enabled` is "at least one active connection".
 */
export const useLinearIntegration = () => {
  const workspaceId = useActiveWorkspaceId();
  const config = useSWR(linearKeys.config(), () => linearService.getConfig());
  const connections = useSWR(linearKeys.connections(workspaceId), () =>
    linearService.listConnections(),
  );

  const isInitialLoading = config.data === undefined || connections.data === undefined;
  const error = config.error ?? connections.error;
  const mutate = () => {
    void config.mutate();
    void connections.mutate();
  };

  return {
    config: config.data,
    connections: connections.data ?? [],
    enabled: (connections.data?.length ?? 0) > 0,
    error,
    isInitialLoading,
    mutate,
  };
};
