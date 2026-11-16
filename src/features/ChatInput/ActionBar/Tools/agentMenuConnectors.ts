import isEqual from 'fast-deep-equal';
import { useMemo } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useAgentStore } from '@/store/agent';
import { useToolStore } from '@/store/tool';
import { connectorSelectors } from '@/store/tool/slices/connector';
import type { ConnectorWithTools } from '@/store/tool/slices/connector/types';

/**
 * The MCP connectors an agent's skill menu offers: the ones that agent loads,
 * by the rule the server applies to its configuration and runs
 * (`connectorAgentConfigScope`, then `ConnectorModel.pickByPriority`).
 *
 * - Outside a workspace nothing is private: every listed connector.
 * - A workspace agent loads the shared connectors only. The caller's private
 *   connectors never run in it, so the menu does not offer them for pinning.
 * - A private agent also loads its owner's private connectors (the workspace
 *   list holds no one else's). A private and a shared connector of the same
 *   identifier resolve to the private one at run time, so the menu keeps that
 *   row: the one its settings and the pin act on.
 */
export const agentMenuConnectors = (
  connectors: ConnectorWithTools[],
  { inWorkspace, privateAgent }: { inWorkspace: boolean; privateAgent: boolean },
): ConnectorWithTools[] => {
  if (!inWorkspace) return connectors;
  if (!privateAgent) return connectors.filter((c) => c.visibility !== 'private');

  const byIdentifier = new Map<string, ConnectorWithTools>();
  for (const connector of connectors) {
    const current = byIdentifier.get(connector.identifier);
    if (!current || (connector.visibility === 'private' && current.visibility !== 'private'))
      byIdentifier.set(connector.identifier, connector);
  }
  return [...byIdentifier.values()];
};

/** {@link agentMenuConnectors} for `agentId`, from the user's MCP connectors. */
export const useAgentMenuConnectors = (agentId?: string): ConnectorWithTools[] => {
  const inWorkspace = !!useActiveWorkspaceId();
  const privateAgent = useAgentStore(
    (s) => !!agentId && s.agentMap[agentId]?.visibility === 'private',
  );
  const connectors = useToolStore(connectorSelectors.userMcpConnectors, isEqual);

  // A stable list: the menu rebuilds its connector rows when this changes
  return useMemo(
    () => agentMenuConnectors(connectors, { inWorkspace, privateAgent }),
    [connectors, inWorkspace, privateAgent],
  );
};
