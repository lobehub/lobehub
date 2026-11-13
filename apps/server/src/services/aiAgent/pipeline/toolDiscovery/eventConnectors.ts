import type { DecryptedConnector } from '@/database/models/connector';

/** Only enabled remote MCP endpoints can deliver webhooks to the server. */
export const hasSupportedEventConnector = (connectors: readonly DecryptedConnector[]): boolean =>
  connectors.some(
    (connector) =>
      connector.isEnabled &&
      connector.mcpConnectionType === 'http' &&
      !!connector.mcpServerUrl &&
      connector.metadata?.capabilities?.events?.supported === true,
  );
