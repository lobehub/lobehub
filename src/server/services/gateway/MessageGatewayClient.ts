import debug from 'debug';

import { gatewayEnv } from '@/envs/gateway';

const log = debug('lobe-server:message-gateway-client');

// ─── Types ───

export interface MessageGatewayConnectionConfig {
  /** Platform application ID (e.g., Feishu appId, QQ appId) */
  applicationId?: string;
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
 * HTTP client for the message-gateway Cloudflare Worker.
 *
 * The gateway is a pure connection proxy — it only manages persistent
 * connections (WebSocket/long-polling) and forwards inbound events to
 * LobeHub's webhook. Outbound messaging is NOT routed through the gateway;
 * LobeHub calls platform REST APIs directly.
 */
export class MessageGatewayClient {
  private baseUrl: string;
  private serviceToken: string;

  constructor(baseUrl?: string, serviceToken?: string) {
    if (baseUrl !== undefined) {
      this.baseUrl = baseUrl;
      this.serviceToken = serviceToken || '';
    } else {
      this.baseUrl = gatewayEnv.MESSAGE_GATEWAY_URL || '';
      this.serviceToken = gatewayEnv.MESSAGE_GATEWAY_SERVICE_TOKEN || '';
    }
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

  async connect(config: MessageGatewayConnectionConfig): Promise<{ status: string }> {
    log('Connecting %s:%s (platform=%s)', config.connectionId, config.userId, config.platform);

    const res = await this.post('/api/connections', { config });

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

// ─── Singleton ───

let _client: MessageGatewayClient | undefined;

export function getMessageGatewayClient(): MessageGatewayClient {
  if (!_client) {
    _client = new MessageGatewayClient();
  }
  return _client;
}
