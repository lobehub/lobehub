import type { ConnectorWithTools } from '@/store/tool/slices/connector/types';

/**
 * Whether the connector's MCP server accepts event subscriptions, as learned
 * on the last tool sync (`metadata.capabilities.events`, 契约 3.6). The
 * metadata is free-form JSON, so every level is checked rather than trusted.
 * A connector synced before the capability existed reads as unsupported
 * until its next sync.
 */
export const connectorSupportsEvents = (connector: Pick<ConnectorWithTools, 'metadata'>) => {
  const capabilities = connector.metadata?.capabilities;
  if (typeof capabilities !== 'object' || capabilities === null) return false;
  const events = (capabilities as { events?: unknown }).events;
  if (typeof events !== 'object' || events === null) return false;
  return (events as { supported?: unknown }).supported === true;
};
