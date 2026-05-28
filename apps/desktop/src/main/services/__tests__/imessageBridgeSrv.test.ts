import { request } from 'node:http';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import ImessageBridgeService from '../imessageBridgeSrv';

const { MockBlueBubblesApiClient, getPortMock } = vi.hoisted(() => {
  class _MockBlueBubblesApiClient {
    static instances: _MockBlueBubblesApiClient[] = [];

    getMessage = vi.fn().mockResolvedValue({
      chats: [{ guid: 'iMessage;-;chat-1' }],
      guid: 'msg-1',
      text: 'hello',
    });
    listWebhooks = vi.fn().mockResolvedValue([]);
    ping = vi.fn().mockResolvedValue(undefined);
    registerWebhook = vi.fn().mockResolvedValue({ events: ['new-message'], id: 1 });
    sendText = vi.fn().mockResolvedValue({ guid: 'sent-1', text: 'hello' });

    constructor(public options: unknown) {
      _MockBlueBubblesApiClient.instances.push(this);
    }
  }

  return {
    MockBlueBubblesApiClient: _MockBlueBubblesApiClient,
    getPortMock: vi.fn().mockResolvedValue(43_210),
  };
});

vi.mock('@lobechat/chat-adapter-imessage', () => ({
  BlueBubblesApiClient: MockBlueBubblesApiClient,
}));

vi.mock('get-port-please', () => ({
  getPort: getPortMock,
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

const config = {
  applicationId: 'home-mac-mini',
  blueBubblesPassword: 'local-password',
  blueBubblesServerUrl: 'http://127.0.0.1:1234',
  enabled: true,
  webhookSecret: 'shared-secret',
};

function createService() {
  const store = new Map<string, unknown>([['imessageBridgeConfigs', []]]);
  const app = {
    storeManager: {
      get: vi.fn((key: string, fallback?: unknown) => store.get(key) ?? fallback),
      set: vi.fn((key: string, value: unknown) => store.set(key, value)),
    },
  } as unknown as App;

  const service = new ImessageBridgeService(app);
  service.setRemoteServerProvider({
    getAccessToken: vi.fn().mockResolvedValue('access-token'),
    getServerUrl: vi.fn().mockResolvedValue('https://lobehub.example.com'),
  });

  return { app, service, store };
}

function postLocal(path: string, body: unknown): Promise<{ body: string; status: number }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = request(
      {
        headers: {
          'Content-Length': Buffer.byteLength(payload),
          'Content-Type': 'application/json',
        },
        hostname: '127.0.0.1',
        method: 'POST',
        path,
        port: 43_210,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () =>
          resolve({
            body: Buffer.concat(chunks).toString('utf8'),
            status: res.statusCode ?? 0,
          }),
        );
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

describe('ImessageBridgeService', () => {
  let fetchSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    MockBlueBubblesApiClient.instances = [];
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('stores local BlueBubbles credentials and registers a loopback webhook', async () => {
    const { service, store } = createService();

    const saved = await service.upsertConfig(config);

    expect(saved).toMatchObject({
      applicationId: 'home-mac-mini',
      blueBubblesPasswordSet: true,
      blueBubblesServerUrl: 'http://127.0.0.1:1234',
      enabled: true,
    });
    expect(store.get('imessageBridgeConfigs')).toEqual([config]);
    expect(MockBlueBubblesApiClient.instances.at(-1)?.registerWebhook).toHaveBeenCalledWith(
      'http://127.0.0.1:43210/webhooks/bluebubbles/home-mac-mini?secret=shared-secret',
      ['new-message'],
    );

    await service.stop();
  });

  it('keeps the saved BlueBubbles password when updating bridge metadata', async () => {
    const { service, store } = createService();
    await service.upsertConfig(config);

    await service.upsertConfig({
      applicationId: 'home-mac-mini',
      blueBubblesServerUrl: 'http://127.0.0.1:5678',
      enabled: true,
      webhookSecret: 'new-secret',
    });

    expect(store.get('imessageBridgeConfigs')).toEqual([
      {
        applicationId: 'home-mac-mini',
        blueBubblesPassword: 'local-password',
        blueBubblesServerUrl: 'http://127.0.0.1:5678',
        enabled: true,
        webhookSecret: 'new-secret',
      },
    ]);

    await service.stop();
  });

  it('executes outbound iMessage sends from device-gateway message API calls', async () => {
    const { service } = createService();
    await service.upsertConfig(config);

    const result = await service.handleGatewayMessageApi('sendText', {
      applicationId: 'home-mac-mini',
      chatGuid: 'iMessage;-;chat-1',
      message: 'hello',
    });

    expect(result).toEqual({ guid: 'sent-1', text: 'hello' });
    expect(MockBlueBubblesApiClient.instances.at(-1)?.sendText).toHaveBeenCalledWith(
      'iMessage;-;chat-1',
      'hello',
      undefined,
    );

    await service.stop();
  });

  it('receives BlueBubbles webhook locally and forwards the enriched event to LobeHub', async () => {
    const { service } = createService();
    await service.upsertConfig(config);

    const response = await postLocal('/webhooks/bluebubbles/home-mac-mini?secret=shared-secret', {
      data: { guid: 'msg-1' },
      type: 'new-message',
    });

    expect(response.status).toBe(200);
    expect(String(fetchSpy.mock.calls[0][0])).toBe(
      'https://lobehub.example.com/api/agent/webhooks/imessage/home-mac-mini?secret=shared-secret',
    );
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({
      headers: {
        'Authorization': 'Bearer access-token',
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });
    const forwarded = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(forwarded.data.chats[0].guid).toBe('iMessage;-;chat-1');

    await service.stop();
  });

  it('stops the loopback server when the last enabled config is disabled', async () => {
    const { service } = createService();
    await service.upsertConfig(config);
    expect(service.getStatus().running).toBe(true);

    await service.upsertConfig({ ...config, enabled: false });

    const status = service.getStatus();
    expect(status.running).toBe(false);
    expect(status.configs[0]).toMatchObject({ applicationId: 'home-mac-mini', enabled: false });
  });
});
