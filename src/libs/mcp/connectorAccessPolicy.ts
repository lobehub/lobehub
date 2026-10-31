import { readComposioToolVersion } from '@lobechat/connector-data';

import type { ConnectorMetadata } from '@/database/schemas';

interface AccessControlledConnector {
  agentId?: string | null;
  identifier?: string;
  isEnabled: boolean;
  metadata?: ConnectorMetadata | null;
  status?: string;
}

export const hasNativeConnectorPolicy = (connector: AccessControlledConnector): boolean =>
  !!connector.metadata && Object.hasOwn(connector.metadata, 'nativeAccess');

/** Unmanaged connections keep the existing LobeHub policy; malformed managed rows deny. */
export const canUseNativeConnector = (
  connector: AccessControlledConnector,
  agentId?: string,
): boolean => {
  if (!hasNativeConnectorPolicy(connector)) return true;
  // Market SDK 0.46 dispatch/revoke select by provider only. Native Notion
  // stays closed until Market atomically binds the approved account (U23).
  if (connector.identifier === 'notion') return false;
  const policy = connector.metadata?.nativeAccess;
  return !!(
    connector.isEnabled &&
    connector.status === 'connected' &&
    agentId &&
    (!connector.agentId || connector.agentId === agentId) &&
    policy &&
    Array.isArray(policy.agentIds) &&
    policy.agentIds.every((id) => typeof id === 'string') &&
    policy.agentIds.includes(agentId) &&
    Array.isArray(policy.readToolNames) &&
    policy.readToolNames.every((name) => typeof name === 'string')
  );
};

export const canCallNativeConnectorTool = (
  connector: AccessControlledConnector,
  agentId: string | undefined,
  toolName: string,
): boolean =>
  !hasNativeConnectorPolicy(connector) ||
  (canUseNativeConnector(connector, agentId) &&
    connector.metadata!.nativeAccess!.readToolNames.includes(toolName) &&
    (!connector.metadata?.composio ||
      !!readComposioToolVersion(connector.metadata.nativeAccess?.readToolVersions?.[toolName])));
