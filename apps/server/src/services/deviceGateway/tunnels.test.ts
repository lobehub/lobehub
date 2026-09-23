import type * as DeviceGatewayClient from '@lobechat/device-gateway-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTunnel: vi.fn(),
  listTunnels: vi.fn(),
  resolveTunnel: vi.fn(),
  revokeTunnel: vi.fn(),
}));

vi.mock('@lobechat/device-gateway-client', async (importOriginal) => ({
  ...(await importOriginal<typeof DeviceGatewayClient>()),
  GatewayHttpClient: vi.fn().mockImplementation(function () {
    return mocks;
  }),
}));

vi.mock('@/envs/gateway', () => ({
  gatewayEnv: {
    DEVICE_GATEWAY_SERVICE_TOKEN: 'service-token',
    DEVICE_GATEWAY_URL: 'https://gateway.test',
  },
}));

const { DeviceTunnelRegistry } = await import('./tunnels');

const registration = (overrides: Record<string, unknown> = {}) => ({
  createdAt: 1_000,
  createdBy: 'user-1',
  deviceId: 'device-1',
  hostname: '3000--abcdefgh.lobe.sh',
  port: 3000,
  principal: 'user:user-1',
  slug: 'abcdefgh',
  ...overrides,
});

let registry: InstanceType<typeof DeviceTunnelRegistry>;

beforeEach(() => {
  vi.clearAllMocks();
  registry = new DeviceTunnelRegistry();
});

describe('DeviceTunnelRegistry', () => {
  describe('create', () => {
    it('registers against the caller personal principal and returns the link', async () => {
      mocks.createTunnel.mockResolvedValue(registration());

      const link = await registry.create({ deviceId: 'device-1', port: 3000, userId: 'user-1' });

      expect(mocks.createTunnel).toHaveBeenCalledWith({
        createdBy: 'user-1',
        deviceId: 'device-1',
        port: 3000,
        principal: 'user:user-1',
        ttlSeconds: undefined,
      });
      expect(link).toMatchObject({ slug: 'abcdefgh', url: 'https://3000--abcdefgh.lobe.sh/' });
    });

    it('registers a workspace tunnel against the workspace principal', async () => {
      mocks.createTunnel.mockResolvedValue(registration({ principal: 'workspace:ws-1' }));

      await registry.create({
        deviceId: 'device-1',
        port: 5173,
        userId: 'user-1',
        workspaceId: 'ws-1',
      });

      // Workspace tunnels are reachable by every member, so they must not be
      // filed under the creator's personal principal.
      expect(mocks.createTunnel).toHaveBeenCalledWith(
        expect.objectContaining({ createdBy: 'user-1', principal: 'workspace:ws-1' }),
      );
    });
  });

  describe('list', () => {
    it('returns newest first and can narrow to one device', async () => {
      mocks.listTunnels.mockResolvedValue([
        registration({ createdAt: 1, deviceId: 'device-1', slug: 'aaaaaaaa' }),
        registration({ createdAt: 3, deviceId: 'device-2', slug: 'bbbbbbbb' }),
        registration({ createdAt: 2, deviceId: 'device-1', slug: 'cccccccc' }),
      ]);

      const all = await registry.list({ userId: 'user-1' });
      expect(all.map((link) => link.slug)).toEqual(['bbbbbbbb', 'cccccccc', 'aaaaaaaa']);

      const scoped = await registry.list({ deviceId: 'device-1', userId: 'user-1' });
      expect(scoped.map((link) => link.slug)).toEqual(['cccccccc', 'aaaaaaaa']);
    });
  });

  describe('revoke', () => {
    it('revokes a tunnel the caller owns', async () => {
      mocks.resolveTunnel.mockResolvedValue(registration());
      mocks.revokeTunnel.mockResolvedValue(true);

      expect(await registry.revoke({ slug: 'abcdefgh', userId: 'user-1' })).toBe('revoked');
      expect(mocks.revokeTunnel).toHaveBeenCalledWith('abcdefgh');
    });

    it('refuses to delete another principal tunnel', async () => {
      mocks.resolveTunnel.mockResolvedValue(registration({ principal: 'user:someone-else' }));

      // The gateway admin API deletes any slug it is handed, so ownership has
      // to be proven here or one user could revoke another user's tunnel.
      expect(await registry.revoke({ slug: 'abcdefgh', userId: 'user-1' })).toBe('forbidden');
      expect(mocks.revokeTunnel).not.toHaveBeenCalled();
    });

    it('refuses a workspace tunnel when the caller is out of that workspace', async () => {
      mocks.resolveTunnel.mockResolvedValue(registration({ principal: 'workspace:ws-1' }));

      expect(await registry.revoke({ slug: 'abcdefgh', userId: 'user-1' })).toBe('forbidden');
      expect(
        await registry.revoke({ slug: 'abcdefgh', userId: 'user-1', workspaceId: 'ws-1' }),
      ).not.toBe('forbidden');
    });

    it('reports an unknown slug instead of throwing', async () => {
      mocks.resolveTunnel.mockResolvedValue(undefined);

      expect(await registry.revoke({ slug: 'zzzzzzzz', userId: 'user-1' })).toBe('not-found');
      expect(mocks.revokeTunnel).not.toHaveBeenCalled();
    });
  });
});

describe('DeviceTunnelRegistry without a configured gateway', () => {
  it('degrades instead of failing', async () => {
    vi.resetModules();
    vi.doMock('@/envs/gateway', () => ({ gatewayEnv: {} }));
    const { DeviceTunnelRegistry: Unconfigured } = await import('./tunnels');
    const unconfigured = new Unconfigured();

    expect(await unconfigured.create({ deviceId: 'd', port: 3000, userId: 'u' })).toBeUndefined();
    expect(await unconfigured.list({ userId: 'u' })).toEqual([]);
    expect(await unconfigured.revoke({ slug: 'abcdefgh', userId: 'u' })).toBe('not-found');
  });
});
