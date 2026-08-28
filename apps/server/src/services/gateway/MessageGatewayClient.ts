import debug from 'debug';

import { gatewayEnv } from '@/envs/gateway';

const log = debug('lobe-server:message-gateway-client');

// ─── Types ───

/**
 * Feature capabilities the gateway may use to filter inbound traffic at the
 * edge before forwarding to LobeHub. Advisory: the server-side routers stay
 * authoritative, and gateways that don't understand a capability simply
 * forward everything (current behavior).
 */
export interface MessageGatewayCapabilities {
  /**
   * Passive channel monitoring. When disabled, the gateway is free to drop
   * ordinary channel messages (not DMs, not mentions/replies to the bot,
   * not commands/interactions) instead of forwarding them.
   */
  messageMonitoring?: {
    enabled: boolean;
  };
}

export interface MessageGatewayConnectionConfig {
  /** Platform application ID (e.g., Feishu appId, QQ appId) */
  applicationId?: string;
  /** Edge-filtering capabilities for this connection. Omitted = forward everything. */
  capabilities?: MessageGatewayCapabilities;
  connectionId: string;
  /** Preferred connection mode (e.g., "webhook", "websocket"). Falls back to platform default if omitted. */
  connectionMode?: string;
  credentials: Record<string, unknown>;
  platform: string;
  userId: string;
  webhookPath: string;
}

export interface MessageGatewayConnectionStatus {
  config: { connectionId: string; platform: string } | null;
  state: {
    connectedAt?: number;
    errorCode?: string;
    error?: string;
    platform: string;
    status: 'connected' | 'connecting' | 'disconnected' | 'dormant' | 'error';
  };
}

export interface MessageGatewayStats {
  byPlatform: Record<string, number>;
  connections: Array<{
    connectionId: string;
    platform: string;
    state: { status: string };
    userId: string;
  }>;
  total: number;
}

// ─── Client ───

/**
 * HTTP client for one message-gateway deployment.
 *
 * A gateway is a pure connection proxy — it only manages persistent
 * connections (WebSocket/long-polling) and forwards inbound events to
 * LobeHub's webhook. Outbound messaging is NOT routed through the gateway;
 * LobeHub calls platform REST APIs directly.
 *
 * Deliberately one class for every host: the deployments speak the same HTTP
 * protocol, and the reconcile sync diffs them uniformly. Per-host behaviour
 * differences belong in the routing layer below, not in a subclass — see
 * `resolveMessageGatewayHost`. If a method ever becomes host-specific, split
 * this into a shared-protocol base plus a per-host subclass at that point.
 *
 * The endpoint is always passed in; `getMessageGatewayClientForHost` is the
 * single place that reads it out of the environment.
 */
export class MessageGatewayClient {
  private baseUrl: string;
  private serviceToken: string;

  constructor(baseUrl: string, serviceToken: string) {
    this.baseUrl = baseUrl;
    this.serviceToken = serviceToken;
  }

  get isConfigured(): boolean {
    return !!(this.baseUrl && this.serviceToken);
  }

  /**
   * Whether the gateway should be used for active flows (typing, connect, etc.).
   * Requires MESSAGE_GATEWAY_ENABLED=1 in addition to URL/token. This lets us
   * disable the gateway during migration while keeping the client reachable
   * for cleanup (via isConfigured).
   */
  get isEnabled(): boolean {
    return gatewayEnv.MESSAGE_GATEWAY_ENABLED === '1' && this.isConfigured;
  }

  // ─── Connection Management ───

  /**
   * `ensure: true` marks a reconcile-driven connect (periodic sync): when the
   * gateway DO already holds an identical config it preserves its park/backoff
   * state instead of resetting it — a parked connection answers 409. Omit for
   * user-driven connects (credential saves, manual reconnect), which must
   * always get a full fresh lifecycle.
   */
  async connect(
    config: MessageGatewayConnectionConfig,
    options?: { ensure?: boolean },
  ): Promise<{ status: MessageGatewayConnectionStatus['state']['status'] }> {
    log('Connecting %s:%s (platform=%s)', config.connectionId, config.userId, config.platform);

    const res = await this.post('/api/connections', { config, ensure: options?.ensure });

    if (!res.ok) {
      const error = await res.text();
      log('Connect failed: %s', error);
      throw new Error(`message-gateway connect failed (${res.status}): ${error}`);
    }

    return res.json();
  }

  async disconnectAll(): Promise<{ total: number }> {
    log('Disconnecting all connections');

    const res = await this.fetch('/api/connections', { method: 'DELETE' });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`message-gateway disconnect-all failed (${res.status}): ${error}`);
    }

    return res.json();
  }

  async disconnect(connectionId: string): Promise<{ status: string }> {
    log('Disconnecting %s', connectionId);

    const res = await this.fetch(`/api/connections/${encodeURIComponent(connectionId)}`, {
      method: 'DELETE',
    });

    if (!res.ok) {
      const error = await res.text();
      log('Disconnect failed: %s', error);
      throw new Error(`message-gateway disconnect failed (${res.status}): ${error}`);
    }

    return res.json();
  }

  // ─── Typing ───

  async startTyping(connectionId: string, platformThreadId: string): Promise<void> {
    await this.post(`/api/connections/${encodeURIComponent(connectionId)}/typing`, {
      platformThreadId,
    });
  }

  async stopTyping(connectionId: string, platformThreadId: string): Promise<void> {
    await this.fetch(`/api/connections/${encodeURIComponent(connectionId)}/typing`, {
      body: JSON.stringify({ platformThreadId }),
      headers: { 'Content-Type': 'application/json' },
      method: 'DELETE',
    });
  }

  // ─── Status & Admin ───

  async getStatus(connectionId: string): Promise<MessageGatewayConnectionStatus> {
    const res = await this.fetch(`/api/connections/${encodeURIComponent(connectionId)}/status`);

    if (!res.ok) {
      throw new Error(`message-gateway status failed (${res.status})`);
    }

    return res.json();
  }

  async getStats(): Promise<MessageGatewayStats> {
    const res = await this.fetch('/api/admin/stats');

    if (!res.ok) {
      throw new Error(`message-gateway stats failed (${res.status})`);
    }

    return res.json();
  }

  /**
   * All connectionIds the gateway has ever registered and not yet explicitly
   * disconnected. Unlike `getStats` (which the AdminDO prunes after 30min of
   * silence), this set retains dormant/hibernated connections, so it is the
   * authoritative "actual" set for reconciliation.
   */
  async getRegisteredIds(): Promise<{ ids: string[] }> {
    const res = await this.fetch('/api/admin/registered-ids');

    if (!res.ok) {
      throw new Error(`message-gateway registered-ids failed (${res.status})`);
    }

    return res.json();
  }

  /**
   * What this gateway says it can do. Optional by design: the Cloudflare
   * gateway has no such endpoint, so anything unreachable, missing or
   * unparseable comes back as `null` — "makes no claim", never "claims
   * nothing". A caller must not read absence of information as a refusal.
   */
  async getCapabilities(): Promise<{ platforms?: string[] } | null> {
    try {
      const res = await this.fetch('/api/admin/capabilities');
      if (!res.ok) return null;
      const body = (await res.json()) as { platforms?: unknown };
      if (!Array.isArray(body?.platforms)) return null;
      return { platforms: body.platforms.filter((p): p is string => typeof p === 'string') };
    } catch (err) {
      log('Capabilities unavailable: %O', err);
      return null;
    }
  }

  // ─── Internal HTTP ───

  private async fetch(path: string, init?: RequestInit): Promise<Response> {
    if (!this.isConfigured) {
      throw new Error(
        'MessageGatewayClient not configured: set MESSAGE_GATEWAY_URL and MESSAGE_GATEWAY_SERVICE_TOKEN',
      );
    }

    const url = `${this.baseUrl}${path}`;

    return globalThis.fetch(url, {
      ...init,
      headers: {
        ...init?.headers,
        Authorization: `Bearer ${this.serviceToken}`,
      },
    });
  }

  private async post(path: string, body: unknown): Promise<Response> {
    return this.fetch(path, {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
  }
}

// ─── Host routing ───

/**
 * A "host" is one deployed message-gateway a platform's connections live on:
 *
 *  - `default` — the original gateway (`MESSAGE_GATEWAY_URL`), Cloudflare
 *    Workers + Durable Objects. Right for webhook and hibernation-friendly
 *    platforms.
 *  - `node` — the Node gateway (`MESSAGE_GATEWAY_NODE_URL`), a long-lived
 *    container speaking the same HTTP protocol. Right for platforms a DO
 *    can't host economically (permanent long-polling loops such as WeChat)
 *    or at all (native deps such as Baileys).
 *
 * `MESSAGE_GATEWAY_NODE_PLATFORMS` decides which platforms route to `node`;
 * everything else stays on `default`. The reconcile sync uses the same
 * resolution to move existing connections between hosts, so editing the env
 * var is the entire migration/rollback procedure.
 */
export type MessageGatewayHost = 'default' | 'node';

const parseNodePlatforms = (): Set<string> =>
  new Set(
    (gatewayEnv.MESSAGE_GATEWAY_NODE_PLATFORMS ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  );

/** The host that should own connections for `platform` (default host when omitted). */
export function resolveMessageGatewayHost(platform?: string): MessageGatewayHost {
  if (!platform || !gatewayEnv.MESSAGE_GATEWAY_NODE_URL) return 'default';
  return parseNodePlatforms().has(platform) ? 'node' : 'default';
}

/**
 * Hosts the reconcile sync must visit. The default host is always included —
 * even with every platform routed away it still needs stale cleanup.
 */
export function getConfiguredMessageGatewayHosts(): MessageGatewayHost[] {
  return gatewayEnv.MESSAGE_GATEWAY_NODE_URL ? ['default', 'node'] : ['default'];
}

// ─── Singleton per host ───

const clients = new Map<MessageGatewayHost, MessageGatewayClient>();

export function getMessageGatewayClientForHost(host: MessageGatewayHost): MessageGatewayClient {
  let client = clients.get(host);
  if (!client) {
    client = new MessageGatewayClient(
      messageGatewayHostUrl(host) || '',
      // Both gateways share one service token — inbound webhook/callback
      // validation only accepts this value anyway.
      gatewayEnv.MESSAGE_GATEWAY_SERVICE_TOKEN || '',
    );
    clients.set(host, client);
  }
  return client;
}

/**
 * Client for the gateway that owns `platform`'s connections. Callers that
 * operate on a concrete connection must pass the platform; omitting it
 * returns the default-host client (kill switch checks, legacy cleanup).
 */
export function getMessageGatewayClient(platform?: string): MessageGatewayClient {
  return getMessageGatewayClientForHost(resolveMessageGatewayHost(platform));
}

/** Base URL configured for `host`, if any. The only env→host URL mapping. */
function messageGatewayHostUrl(host: MessageGatewayHost): string | undefined {
  return host === 'node' ? gatewayEnv.MESSAGE_GATEWAY_NODE_URL : gatewayEnv.MESSAGE_GATEWAY_URL;
}

/**
 * Whether `host` has both a URL and a token. Reads env directly rather than
 * asking a client: clients are cached per host and hold the endpoint they were
 * built with, so they answer for the environment as it was the first time
 * anyone asked.
 */
export function isMessageGatewayHostConfigured(host: MessageGatewayHost): boolean {
  return !!messageGatewayHostUrl(host) && !!gatewayEnv.MESSAGE_GATEWAY_SERVICE_TOKEN;
}

/**
 * Whether this deployment is gateway-managed at all — as opposed to "which
 * host owns this platform?".
 *
 * Deliberately anchored on the DEFAULT host. Gateway mode is a whole-process
 * switch (taking it means the in-process runtime never starts), and every
 * platform absent from `MESSAGE_GATEWAY_NODE_PLATFORMS` resolves to the
 * default host — so without one configured, some platform always ends up with
 * a client that cannot connect and no fallback.
 *
 * A deployment with ONLY a Node gateway is therefore not supported here, and
 * that is a capability statement rather than an omission: the Node gateway
 * hosts long-polling and native-dep platforms only, so it can never serve the
 * webhook and websocket platforms the default host carries. Serving those
 * from a Node-only deployment would need a per-platform runtime decision
 * instead of one process-wide flag.
 */
export function isAnyMessageGatewayEnabled(): boolean {
  return gatewayEnv.MESSAGE_GATEWAY_ENABLED === '1' && isMessageGatewayHostConfigured('default');
}
