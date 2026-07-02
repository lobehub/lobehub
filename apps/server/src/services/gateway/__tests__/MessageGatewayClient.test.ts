import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageGatewayClient } from '../MessageGatewayClient';

const mockGatewayEnv = vi.hoisted(() => ({
  MESSAGE_GATEWAY_ENABLED: undefined as string | undefined,
}));

vi.mock('@/envs/gateway', () => ({
  gatewayEnv: mockGatewayEnv,
}));

describe('MessageGatewayClient', () => {
  let client: MessageGatewayClient;

  beforeEach(() => {
    client = new MessageGatewayClient('https://message-gateway.test.com', 'test-service-token');
  });

  describe('isConfigured', () => {
    it('returns true when both url and token are set', () => {
      expect(client.isConfigured).toBe(true);
    });

    it('returns false when url is missing', () => {
      const c = new MessageGatewayClient('', 'token');
      expect(c.isConfigured).toBe(false);
    });

    it('returns false when token is missing', () => {
      const c = new MessageGatewayClient('https://example.com', '');
      expect(c.isConfigured).toBe(false);
    });
  });

  describe('isEnabled', () => {
    it('returns false when configured but MESSAGE_GATEWAY_ENABLED is not 1', () => {
      mockGatewayEnv.MESSAGE_GATEWAY_ENABLED = undefined;
      expect(client.isEnabled).toBe(false);
    });

    it('returns false when MESSAGE_GATEWAY_ENABLED=1 but not configured', () => {
      mockGatewayEnv.MESSAGE_GATEWAY_ENABLED = '1';
      const c = new MessageGatewayClient('', '');
      expect(c.isEnabled).toBe(false);
    });

    it('returns true when MESSAGE_GATEWAY_ENABLED=1 and configured', () => {
      mockGatewayEnv.MESSAGE_GATEWAY_ENABLED = '1';
      expect(client.isEnabled).toBe(true);
    });
  });

  describe('connect', () => {
    it('calls POST /api/connections with config', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ status: 'connected' }),
        ok: true,
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await client.connect({
        connectionId: 'conn-1',
        credentials: { botToken: 'test' },
        platform: 'discord',
        userId: 'user-1',
        webhookPath: '/api/agent/webhooks/discord/app1',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://message-gateway.test.com/api/connections',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(result.status).toBe('connected');

      vi.unstubAllGlobals();
    });

    it('throws on non-ok response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          text: () => Promise.resolve('Internal error'),
        }),
      );

      await expect(
        client.connect({
          connectionId: 'conn-1',
          credentials: {},
          platform: 'discord',
          userId: 'user-1',
          webhookPath: '/test',
        }),
      ).rejects.toThrow('connect failed (500)');

      vi.unstubAllGlobals();
    });
  });

  describe('disconnect', () => {
    it('calls DELETE /api/connections/:id', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ status: 'disconnected' }),
        ok: true,
      });
      vi.stubGlobal('fetch', mockFetch);

      await client.disconnect('conn-1');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://message-gateway.test.com/api/connections/conn-1',
        expect.objectContaining({ method: 'DELETE' }),
      );

      vi.unstubAllGlobals();
    });
  });

  describe('getStatus', () => {
    it('calls GET /api/connections/:id/status', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            config: { connectionId: 'conn-1', platform: 'discord' },
            state: { platform: 'discord', status: 'connected' },
          }),
        ok: true,
      });
      vi.stubGlobal('fetch', mockFetch);

      const status = await client.getStatus('conn-1');
      expect(status.state.status).toBe('connected');

      vi.unstubAllGlobals();
    });
  });

  describe('getStats', () => {
    it('calls GET /api/admin/stats', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ byPlatform: { discord: 2 }, connections: [], total: 2 }),
        ok: true,
      });
      vi.stubGlobal('fetch', mockFetch);

      const stats = await client.getStats();
      expect(stats.total).toBe(2);

      vi.unstubAllGlobals();
    });
  });

  describe('unconfigured client', () => {
    it('throws when calling methods without configuration', async () => {
      const unconfigured = new MessageGatewayClient('', '');

      await expect(
        unconfigured.connect({
          connectionId: 'test',
          credentials: {},
          platform: 'discord',
          userId: 'user',
          webhookPath: '/test',
        }),
      ).rejects.toThrow('not configured');
    });
  });
});
