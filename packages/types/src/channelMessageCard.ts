import type { ChannelMemberGrantStatus, ChannelMessageMetadata } from './channel';

/**
 * `metadata.deviceGrant` of the message an Agent posts in its direct conversation with a device
 * owner when someone asks to run it on their private device in a Channel. Only `grantId` is
 * authoritative; the rest is the server's snapshot at request time, so the card reads without
 * the Channel.
 */
export interface ChannelDeviceGrantRequest {
  agentName: string | null;
  channelId: string;
  channelTitle: string;
  deviceId: string;
  deviceName: string | null;
  grantId: string;
  requesterName: string | null;
  requesterUserId: string | null;
  workingDirectory: string;
}

/** A request card as its reader sees it: `expired` once the grant was replaced or removed. */
export type ChannelDeviceGrantCard = ChannelDeviceGrantRequest & {
  status: ChannelMemberGrantStatus | 'expired';
};

/** `metadata.deviceGrant` of a device request card, or undefined for anything else. */
export const channelMessageDeviceGrant = (
  metadata: ChannelMessageMetadata | null | undefined,
): ChannelDeviceGrantRequest | undefined => {
  const request = metadata?.deviceGrant as Partial<ChannelDeviceGrantRequest> | undefined;
  return typeof request?.grantId === 'string' &&
    typeof request.channelId === 'string' &&
    typeof request.deviceId === 'string' &&
    typeof request.workingDirectory === 'string'
    ? {
        agentName: request.agentName ?? null,
        channelId: request.channelId,
        channelTitle: request.channelTitle ?? '',
        deviceId: request.deviceId,
        deviceName: request.deviceName ?? null,
        grantId: request.grantId,
        requesterName: request.requesterName ?? null,
        requesterUserId: request.requesterUserId ?? null,
        workingDirectory: request.workingDirectory,
      }
    : undefined;
};

/**
 * The stored text of a request card, for every reader that does not render the card: list
 * previews, notifications and the Agent itself. Clients that render cards localize their own.
 */
export const deviceGrantRequestText = (request: ChannelDeviceGrantRequest) =>
  `[Device request] ${request.requesterName || 'A member'} asks to run ${
    request.agentName || 'this Agent'
  } in "${request.channelTitle}" on ${request.deviceName || request.deviceId} (${
    request.workingDirectory
  }).`;

/**
 * Where a connector an Agent asks for comes from. Catalog sources (`lobehub`, `composio`,
 * `official`) connect through the flow the catalog owns; `custom` is an MCP server outside the
 * catalogs, connected by its URL.
 */
export type ChannelConnectorSource = 'composio' | 'custom' | 'lobehub' | 'official';

/**
 * `metadata.connector` of the card an Agent posts in its own conversation to ask the person to
 * connect a connector it needs; the person connects in place. Only the reader's own connectors
 * decide whether it shows as connected, so the card is a request, never a status.
 */
export interface ChannelConnectorRequest {
  /** The Agent that asked; it uses the connector once the reader connects it. */
  agentId: string;
  /** How a `custom` server authorizes; null for catalog sources, which own their flow. */
  auth: 'none' | 'oauth' | null;
  identifier: string;
  /** Display name; the catalog's label for catalog sources. */
  name: string;
  /** Why the Agent needs it, in its own words; null when it gave none. */
  reason: string | null;
  source: ChannelConnectorSource;
  /** The MCP server of a `custom` connector; null for catalog sources. */
  url: string | null;
}

const CONNECTOR_SOURCES = new Set<ChannelConnectorSource>([
  'composio',
  'custom',
  'lobehub',
  'official',
]);

/** `metadata.connector` of a connector request card, or undefined for anything else. */
export const channelMessageConnector = (
  metadata: ChannelMessageMetadata | null | undefined,
): ChannelConnectorRequest | undefined => {
  const request = metadata?.connector as Partial<ChannelConnectorRequest> | undefined;
  if (
    typeof request?.agentId !== 'string' ||
    typeof request.identifier !== 'string' ||
    !CONNECTOR_SOURCES.has(request.source as ChannelConnectorSource)
  )
    return undefined;
  const custom = request.source === 'custom';
  if (custom && typeof request.url !== 'string') return undefined;
  return {
    agentId: request.agentId,
    auth: custom ? (request.auth === 'oauth' ? 'oauth' : 'none') : null,
    identifier: request.identifier,
    name: typeof request.name === 'string' && request.name ? request.name : request.identifier,
    reason: typeof request.reason === 'string' && request.reason ? request.reason : null,
    source: request.source as ChannelConnectorSource,
    url: custom ? (request.url as string) : null,
  };
};

/**
 * The stored text of a connector request card, for every reader that does not render the card:
 * list previews, notifications and other Agents. Clients that render cards localize their own.
 */
export const connectorRequestText = (request: ChannelConnectorRequest) =>
  `[Connector request] Connect ${request.name} so this Agent can use it.${
    request.reason ? ` ${request.reason}` : ''
  }`;

/**
 * A connector the running Agent asks its requester to connect (`lobe-channel.requestConnector`,
 * `lh connector request`). A catalog identifier is enough; a server outside the catalogs also
 * needs its `url`.
 */
export interface ChannelRequestConnectorParams {
  /** How a server outside the catalogs authorizes; defaults to `oauth`. */
  auth?: 'none' | 'oauth';
  identifier: string;
  /** Display name of a server outside the catalogs; catalog connectors use their own label. */
  name?: string;
  /** One sentence on what the Agent will do with it, shown on the card. */
  reason?: string;
  /** The HTTPS endpoint of an MCP server outside the catalogs. */
  url?: string;
}

/** The card a connector request posted; the person connects from it. */
export interface ChannelConnectorRequestResult {
  messageId: string;
  name: string;
  source: ChannelConnectorSource;
}
