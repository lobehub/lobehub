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

/**
 * A card an Agent drew in its reply, stored in `metadata.surfaces` and drawn by `@lobehub/a2ui`.
 * Mirrors `A2uiSurfaceRecord` there; `fallback` is its one-line text where it can't be drawn.
 */
export interface ChannelMessageSurface {
  catalogId: string;
  fallback: string;
  operations: Record<string, unknown>[];
  /** Set once a person acted on it; a submitted card is read-only. */
  state?: { status: 'open' | 'submitted'; submittedAt?: string };
  surfaceId: string;
  title?: string;
  version: string;
}

/** `metadata.surfaces` of an Agent's reply, keeping only well-formed entries. */
export const channelMessageSurfaces = (
  metadata: ChannelMessageMetadata | null | undefined,
): ChannelMessageSurface[] => {
  const surfaces = metadata?.surfaces;
  if (!Array.isArray(surfaces)) return [];
  return surfaces.filter(
    (surface): surface is ChannelMessageSurface =>
      !!surface &&
      typeof surface === 'object' &&
      typeof (surface as ChannelMessageSurface).surfaceId === 'string' &&
      Array.isArray((surface as ChannelMessageSurface).operations),
  );
};

/** A reply's cards as text, for where cards can't be drawn: history an Agent reads, previews. */
export const channelSurfacesText = (surfaces: ChannelMessageSurface[]) =>
  surfaces
    .map((surface) => surface.fallback || surface.title)
    .filter(Boolean)
    .map((line) => `[Card] ${line}`)
    .join('\n');

/**
 * A message the running Agent posts as itself (`lobe-channel.postMessage`): on the main timeline
 * or a Thread of its current Channel, or of another Channel where it is an active member.
 */
export interface ChannelPostMessageParams {
  /** Another Channel the Agent is a member of; omit for the Channel it is answering in. */
  channelId?: string;
  /** The post's own words; may be empty when it carries cards. */
  content?: string;
  /** Carry the cards this run drew (`lobe-a2ui.renderUI`). Default true. */
  includeCards?: boolean;
  /** A Thread of that Channel; omit for its main timeline. */
  threadId?: string;
}

/** Where a `postMessage` landed. */
export interface ChannelPostedMessage {
  /** How many cards went out with it. */
  cards: number;
  channelId: string;
  channelTitle: string;
  messageId: string;
  /** The Thread it is in; null on the main timeline. */
  threadId: string | null;
  url: string;
}
