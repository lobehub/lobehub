import isEqual from 'fast-deep-equal';
import { useCallback, useMemo } from 'react';

import {
  getActiveWorkspaceId,
  useActiveWorkspaceId,
} from '@/business/client/hooks/useActiveWorkspaceId';
import { useAgentStore } from '@/store/agent';
import { useToolStore } from '@/store/tool';
import { connectorSelectors, pickRunConnectors } from '@/store/tool/slices/connector';
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
  {
    agentId,
    inWorkspace,
    privateAgent,
  }: { agentId?: string; inWorkspace: boolean; privateAgent: boolean },
): ConnectorWithTools[] => {
  if (!inWorkspace) return connectors;

  return pickRunConnectors(connectors, { agentId, includePrivate: privateAgent });
};

/** {@link agentMenuConnectors} for `agentId`, from the user's MCP connectors. */
export const useAgentMenuConnectors = (agentId?: string): ConnectorWithTools[] => {
  const inWorkspace = !!useActiveWorkspaceId();
  const privateAgent = useAgentStore(
    (s) => !!agentId && s.agentMap?.[agentId]?.visibility === 'private',
  );
  // Library connections only: an agent's own connections are managed on its profile
  const connectors = useToolStore(
    connectorSelectors.userMcpConnectorsForAgent(agentId ?? ''),
    isEqual,
  );

  // A stable list: the menu rebuilds its connector rows when this changes
  return useMemo(
    () => agentMenuConnectors(connectors, { agentId, inWorkspace, privateAgent }),
    [agentId, connectors, inWorkspace, privateAgent],
  );
};

/**
 * Whether `agentId` still loads a connector of `deleted`'s identifier once
 * `deleted` is gone: a private connector that shadowed a shared one leaves the
 * shared row serving the identifier.
 */
export const agentStillLoadsIdentifier = (
  connectors: ConnectorWithTools[],
  deleted: Pick<ConnectorWithTools, 'id' | 'identifier'>,
  context: { agentId?: string; inWorkspace: boolean; privateAgent: boolean },
): boolean =>
  agentMenuConnectors(
    connectors.filter((c) => c.id !== deleted.id),
    context,
  ).some((c) => c.identifier === deleted.identifier);

/**
 * Turn a deleted connector off for the agent, as removing a Composio connection
 * does, so no orphaned switch survives it; unless the agent still loads a row of
 * its identifier ({@link agentStillLoadsIdentifier}), which keeps it on. A
 * failed write is logged: the delete has already happened.
 */
export const useUnpinDeletedConnector = (
  agentId: string | undefined,
  /** Turns the connector off for the agent (its two-state switch). */
  turnOff: (identifier: string) => Promise<void>,
) =>
  useCallback(
    async (deleted: ConnectorWithTools) => {
      const context = {
        agentId,
        inWorkspace: !!getActiveWorkspaceId(),
        privateAgent:
          !!agentId && useAgentStore.getState().agentMap?.[agentId]?.visibility === 'private',
      };
      const connectors = connectorSelectors.userMcpConnectors(useToolStore.getState());
      if (agentStillLoadsIdentifier(connectors, deleted, context)) return;

      try {
        await turnOff(deleted.identifier);
      } catch (error) {
        console.error('[Connector] Failed to unpin plugin after delete:', error);
      }
    },
    [agentId, turnOff],
  );
