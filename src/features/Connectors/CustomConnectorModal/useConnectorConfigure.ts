import { useCallback } from 'react';

import { useConnectorManageableChecker } from '@/hooks/useConnectorManagePolicy';

import { openConnectorEditDrawer } from './imperative';

interface ConfigurableConnector {
  agentId?: string | null;
  id: string;
  mcpConnectionType: string | null;
  userId?: string | null;
}

/**
 * The tool picker's "Configure" action for each connector row, one hook call
 * for the whole list. The drawer reads the stored credentials
 * (`connector.getForEdit`), so a viewer who may not manage them gets no action,
 * the rule Settings' Configure follows; while the policy loads nobody does yet.
 * A market-hosted (cloud) connector has no connection settings at all.
 */
export const useConnectorConfigure = () => {
  const checkManageable = useConnectorManageableChecker();

  return useCallback(
    (connector: ConfigurableConnector) =>
      connector.mcpConnectionType === 'cloud' || !checkManageable(connector).canManageCredentials
        ? undefined
        : { onConfigure: () => openConnectorEditDrawer(connector.id) },
    [checkManageable],
  );
};
