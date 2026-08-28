import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getConfiguredMessageGatewayHosts,
  getMessageGatewayClient,
  getMessageGatewayClientForHost,
  isAnyMessageGatewayEnabled,
  MessageGatewayClient,
  resolveMessageGatewayHost,
} from '../MessageGatewayClient';

const mockGatewayEnv = vi.hoisted(() => ({
  MESSAGE_GATEWAY_ENABLED: undefined as string | undefined,
  MESSAGE_GATEWAY_NODE_PLATFORMS: undefined as string | undefined,
  MESSAGE_GATEWAY_NODE_URL: undefined as string | undefined,
  MESSAGE_GATEWAY_SERVICE_TOKEN: undefined as string | undefined,
  MESSAGE_GATEWAY_URL: undefined as string | undefined,
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

  describe('host routing', () => {
    // Set once before the per-host singletons are first constructed — the
    // client cache captures env at construction, while host RESOLUTION reads
    // env live and can be toggled per test.
    beforeAll(() => {
      mockGatewayEnv.MESSAGE_GATEWAY_NODE_PLATFORMS = ' wechat , whatsapp-baileys ';
      mockGatewayEnv.MESSAGE_GATEWAY_NODE_URL = 'https://node-gateway.test.com';
      mockGatewayEnv.MESSAGE_GATEWAY_SERVICE_TOKEN = 'shared-token';
      mockGatewayEnv.MESSAGE_GATEWAY_URL = 'https://message-gateway.test.com';
    });

    it('routes listed platforms to node only while the node gateway is configured', () => {
      expect(resolveMessageGatewayHost('wechat')).toBe('node');
      expect(resolveMessageGatewayHost('whatsapp-baileys')).toBe('node');
      expect(resolveMessageGatewayHost('discord')).toBe('default');
      expect(resolveMessageGatewayHost()).toBe('default');

      mockGatewayEnv.MESSAGE_GATEWAY_NODE_URL = undefined;
      // Rollback path: dropping the node URL sends everything back to default.
      expect(resolveMessageGatewayHost('wechat')).toBe('default');
      mockGatewayEnv.MESSAGE_GATEWAY_NODE_URL = 'https://node-gateway.test.com';
    });

    it('always reconciles the default host, and node only when configured', () => {
      expect(getConfiguredMessageGatewayHosts()).toEqual(['default', 'node']);

      mockGatewayEnv.MESSAGE_GATEWAY_NODE_URL = undefined;
      expect(getConfiguredMessageGatewayHosts()).toEqual(['default']);
      mockGatewayEnv.MESSAGE_GATEWAY_NODE_URL = 'https://node-gateway.test.com';
    });

    it('returns distinct per-host singletons; node uses the shared service token', () => {
      const nodeClient = getMessageGatewayClient('wechat');
      const defaultClient = getMessageGatewayClient('discord');

      expect(nodeClient).toBe(getMessageGatewayClientForHost('node'));
      expect(defaultClient).toBe(getMessageGatewayClientForHost('default'));
      expect(nodeClient).not.toBe(defaultClient);
      // Node URL + the shared MESSAGE_GATEWAY_SERVICE_TOKEN are all it needs.
      expect(nodeClient.isConfigured).toBe(true);
    });

    describe('isAnyMessageGatewayEnabled', () => {
      beforeEach(() => {
        mockGatewayEnv.MESSAGE_GATEWAY_ENABLED = '1';
        mockGatewayEnv.MESSAGE_GATEWAY_NODE_PLATFORMS = 'wechat';
        mockGatewayEnv.MESSAGE_GATEWAY_NODE_URL = 'https://node-gateway.test.com';
        mockGatewayEnv.MESSAGE_GATEWAY_SERVICE_TOKEN = 'shared-token';
        mockGatewayEnv.MESSAGE_GATEWAY_URL = 'https://message-gateway.test.com';
      });

      it('is false while the kill switch is off, whatever is configured', () => {
        mockGatewayEnv.MESSAGE_GATEWAY_ENABLED = undefined;
        expect(isAnyMessageGatewayEnabled()).toBe(false);
      });

      it('is false without a default host, however much the node host is configured', () => {
        // Node-only is out of scope by capability, not by oversight: the Node
        // gateway hosts long-polling/native-dep platforms only, so it can
        // never serve the webhook and websocket platforms that fall back to
        // the default host. Entering gateway mode here would hand those
        // platforms a client that cannot connect, with the in-process runtime
        // already skipped.
        mockGatewayEnv.MESSAGE_GATEWAY_URL = undefined;
        expect(isAnyMessageGatewayEnabled()).toBe(false);
      });

      it('stays true on an empty platform list while the default host is configured', () => {
        // The step-2 rollout shape: node URL deployed, nothing routed to it yet.
        mockGatewayEnv.MESSAGE_GATEWAY_NODE_PLATFORMS = '';
        expect(isAnyMessageGatewayEnabled()).toBe(true);
      });

      it('is true for the cutover shape: default host live, wechat routed to node', () => {
        mockGatewayEnv.MESSAGE_GATEWAY_NODE_PLATFORMS = 'wechat';
        expect(isAnyMessageGatewayEnabled()).toBe(true);
      });
    });
  });
});
