import { devicePrincipal, GatewayHttpClient } from '@lobechat/device-gateway-client';
import debug from 'debug';

import { gatewayEnv } from '@/envs/gateway';

const log = debug('lobe-server:device-tunnels');

/**
 * Tunnel links: an opaque slug that makes one loopback port on one device
 * reachable at `https://<port>--<slug>.lobe.sh/`.
 *
 * Separate from {@link DeviceGateway} because nothing here talks to a device —
 * these calls manage the gateway's own registry. Ownership is enforced on this
 * side: the gateway's admin API trusts the service token and will delete any
 * slug it is handed.
 */

/** Default lifetime of a link, matching the gateway's own default. */
export const TUNNEL_DEFAULT_TTL_SECONDS = 7 * 24 * 3600;
export const TUNNEL_MAX_TTL_SECONDS = 30 * 24 * 3600;

export interface TunnelLink {
  createdAt: number;
  deviceId: string;
  expiresAt?: number;
  /** `<port>--<slug>.lobe.sh` */
  hostname: string;
  port: number;
  slug: string;
  /** The link to open, without the one-shot access token. */
  url: string;
}

export type TunnelRevokeOutcome = 'forbidden' | 'not-found' | 'revoked';

const toLink = (registration: {
  createdAt: number;
  deviceId: string;
  expiresAt?: number;
  hostname?: string;
  port: number;
  slug: string;
}): TunnelLink => {
  const hostname = registration.hostname ?? '';
  return {
    createdAt: registration.createdAt,
    deviceId: registration.deviceId,
    expiresAt: registration.expiresAt,
    hostname,
    port: registration.port,
    slug: registration.slug,
    url: `https://${hostname}/`,
  };
};

export class DeviceTunnelRegistry {
  private client: GatewayHttpClient | null = null;

  /** Open a link to `port` on `deviceId`. Returns undefined when unconfigured. */
  async create(params: {
    deviceId: string;
    port: number;
    ttlSeconds?: number;
    userId: string;
    workspaceId?: string;
  }): Promise<TunnelLink | undefined> {
    const client = this.getClient();
    if (!client) return undefined;

    const registration = await client.createTunnel({
      createdBy: params.userId,
      deviceId: params.deviceId,
      port: params.port,
      principal: devicePrincipal(params),
      ttlSeconds: params.ttlSeconds,
    });
    log('created tunnel %s for device %s:%d', registration.slug, params.deviceId, params.port);
    return toLink(registration);
  }

  /** Every live link the caller can reach, newest first. */
  async list(params: {
    deviceId?: string;
    userId: string;
    workspaceId?: string;
  }): Promise<TunnelLink[]> {
    const client = this.getClient();
    if (!client) return [];

    const tunnels = await client.listTunnels(devicePrincipal(params));
    return tunnels
      .filter((tunnel) => !params.deviceId || tunnel.deviceId === params.deviceId)
      .map((tunnel) => toLink(tunnel))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Revoke a link. The slug is resolved first so a caller can only delete a
   * registration owned by their own principal.
   */
  async revoke(params: {
    slug: string;
    userId: string;
    workspaceId?: string;
  }): Promise<TunnelRevokeOutcome> {
    const client = this.getClient();
    if (!client) return 'not-found';

    const registration = await client.resolveTunnel(params.slug);
    if (!registration) return 'not-found';
    if (registration.principal !== devicePrincipal(params)) return 'forbidden';

    const revoked = await client.revokeTunnel(params.slug);
    return revoked ? 'revoked' : 'not-found';
  }

  private getClient(): GatewayHttpClient | null {
    const url = gatewayEnv.DEVICE_GATEWAY_URL;
    const token = gatewayEnv.DEVICE_GATEWAY_SERVICE_TOKEN;
    if (!url || !token) return null;

    if (!this.client) {
      this.client = new GatewayHttpClient({ gatewayUrl: url, serviceToken: token });
    }
    return this.client;
  }
}

export const deviceTunnels = new DeviceTunnelRegistry();
