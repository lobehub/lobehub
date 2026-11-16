import type { DecryptedConnector } from '@/database/models/connector';
import { CHANNEL_TOPIC_TRIGGER } from '@/database/utils/topicVisibility';

/** Only enabled remote MCP endpoints can deliver webhooks to the server. */
export const hasSupportedEventConnector = (connectors: readonly DecryptedConnector[]): boolean =>
  connectors.some(
    (connector) =>
      connector.isEnabled &&
      connector.mcpConnectionType === 'http' &&
      !!connector.mcpServerUrl &&
      connector.metadata?.capabilities?.events?.supported === true,
  );

/**
 * Whether this run offers the MCP Events tools. A Channel run works in a hidden topic of its
 * own; a subscription made there would wake the agent in that topic, where the Channel never sees
 * the result, so Channel runs do not offer them.
 */
export const offersMcpEvents = (hasEventConnector: boolean, requestTrigger?: string): boolean =>
  hasEventConnector && requestTrigger !== CHANNEL_TOPIC_TRIGGER;
