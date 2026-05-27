import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WatiClientFactory } from './client';

const fetchSpy = vi.spyOn(globalThis, 'fetch');

const APPLICATION_ID = '85264318722';

const createClient = (context: { appUrl?: string } = {}) =>
  new WatiClientFactory().createClient(
    {
      applicationId: APPLICATION_ID,
      credentials: {
        apiBaseUrl: 'https://live-mt-server.wati.io',
        bearerToken: 'bearer-test',
        tenantId: 'tenant-test',
        webhookSecret: 'secret',
      },
      platform: 'wati',
      settings: {},
    },
    { appUrl: 'http://localhost:3010', ...context },
  );

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

beforeEach(() => {
  vi.mock('@/server/services/gateway/runtimeStatus', () => ({
    BOT_RUNTIME_STATUSES: {
      connected: 'connected',
      disconnected: 'disconnected',
      failed: 'failed',
      starting: 'starting',
    },
    getRuntimeStatusErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'unknown'),
    updateBotRuntimeStatus: vi.fn().mockResolvedValue(undefined),
  }));
});

afterEach(() => {
  fetchSpy.mockReset();
});

describe('WatiWebhookClient', () => {
  it('formatMarkdown strips Markdown to plain text', () => {
    const client = createClient();
    expect(client.formatMarkdown!('**hi**')).toBe('hi');
  });

  it('extractChatId pulls waId from thread id', () => {
    const client = createClient();
    expect(client.extractChatId('wati:user:85264318721')).toBe('85264318721');
  });

  it('createAdapter wires credentials into the SDK adapter', () => {
    const client = createClient();
    const adapter = client.createAdapter();
    expect(adapter.wati).toBeDefined();
    expect((adapter.wati as any).botUserId).toBe(APPLICATION_ID);
  });

  it('start resolves webhook phone from Wati list API', async () => {
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('getContacts')) return Promise.resolve(jsonResponse({ ok: true }));
      if (url.includes('whatsapp/phonenumbers')) {
        return Promise.resolve(
          jsonResponse({
            ok: true,
            result: [{ displayPhoneNumber: '852-6431-8722' }],
          }),
        );
      }
      if (url.includes('webhookEndpoints')) {
        return Promise.resolve(jsonResponse({ ok: true, result: [] }));
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    });

    const client = createClient({ appUrl: 'http://localhost:3010' });
    await client.start();

    const webhookCall = fetchSpy.mock.calls.find(([url]) =>
      String(url).includes('/api/v2/webhookEndpoints'),
    );
    expect(webhookCall).toBeDefined();
    const [, init] = webhookCall as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body[0].phoneNumber).toBe('852-6431-8722');
    expect(body[0].url).toBe(`http://localhost:3010/api/agent/webhooks/wati/${APPLICATION_ID}`);
  });

  it('messenger.createMessage POSTs sendSessionMessage with query params', async () => {
    fetchSpy.mockResolvedValue(new Response('{}', { status: 200 }));
    const client = createClient();
    const messenger = client.getMessenger('wati:user:85264318721');
    await messenger.createMessage('hi back');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/tenant-test/api/v1/sendSessionMessage/85264318721');
    expect(url).toContain('messageText=hi+back');
    expect(url).toContain(`channelPhoneNumber=${APPLICATION_ID}`);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer bearer-test');
    expect(init.method).toBe('POST');
  });
});

describe('WatiClientFactory.validateCredentials', () => {
  it('returns errors when required fields are missing', async () => {
    const factory = new WatiClientFactory();
    const result = await factory.validateCredentials({}, {}, '');
    expect(result.valid).toBe(false);
    expect(result.errors?.length).toBeGreaterThan(0);
  });

  it('pings Wati API when credentials are complete', async () => {
    fetchSpy.mockResolvedValue(new Response('{}', { status: 200 }));
    const factory = new WatiClientFactory();
    const result = await factory.validateCredentials(
      {
        apiBaseUrl: 'https://live-mt-server.wati.io',
        bearerToken: 'bearer-test',
        tenantId: 'tenant-test',
      },
      {},
      APPLICATION_ID,
    );
    expect(result.valid).toBe(true);
    expect(fetchSpy).toHaveBeenCalled();
  });
});
