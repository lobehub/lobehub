import { afterEach, describe, expect, it, vi } from 'vitest';

import { WatiApiClient } from './api';

const fetchSpy = vi.spyOn(globalThis, 'fetch');

const client = new WatiApiClient({
  apiBaseUrl: 'https://live-mt-server.wati.io',
  bearerToken: 'bearer-test',
  tenantId: 'tenant-test',
});

afterEach(() => {
  fetchSpy.mockReset();
});

describe('WatiApiClient.registerWebhookForPhone', () => {
  it('uses phone list format when registering webhook', async () => {
    fetchSpy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('whatsapp/phonenumbers')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              result: [{ displayPhoneNumber: '852-9000-0001' }],
            }),
            { status: 200 },
          ),
        );
      }
      if (url.includes('webhookEndpoints') && init?.method === 'GET') {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 }),
        );
      }
      if (url.includes('webhookEndpoints') && init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    });

    await client.registerWebhookForPhone(
      '85290000001',
      'http://localhost:3010/api/agent/webhooks/wati/85290000001',
    );

    const webhookCall = fetchSpy.mock.calls.find(
      ([url, init]) => String(url).includes('/api/v2/webhookEndpoints') && init?.method === 'POST',
    );
    const [, init] = webhookCall as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body[0].phoneNumber).toBe('852-9000-0001');
  });

  it('skips POST when webhook is already registered for the same URL', async () => {
    const webhookUrl = 'http://localhost:3010/api/agent/webhooks/wati/85290000001';

    fetchSpy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('whatsapp/phonenumbers')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              result: [{ displayPhoneNumber: '852-9000-0001' }],
            }),
            { status: 200 },
          ),
        );
      }
      if (url.includes('webhookEndpoints') && init?.method === 'GET') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              result: [
                {
                  channelPhoneNumber: '852-9000-0001',
                  url: webhookUrl,
                },
              ],
            }),
            { status: 200 },
          ),
        );
      }
      if (url.includes('webhookEndpoints') && init?.method === 'POST') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: false,
              error: 'Number of Webhooks exceed limitation',
              isOverWebhookLimit: true,
            }),
            { status: 400 },
          ),
        );
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    });

    const result = await client.registerWebhookForPhone('85290000001', webhookUrl);

    expect(result.ok).toBe(true);
    const postCalls = fetchSpy.mock.calls.filter(
      ([url, init]) => String(url).includes('/api/v2/webhookEndpoints') && init?.method === 'POST',
    );
    expect(postCalls).toHaveLength(0);
  });

  it('throws when webhook limit response does not match a registered endpoint', async () => {
    const webhookUrl = 'http://localhost:3010/api/agent/webhooks/wati/85290000001';

    fetchSpy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('whatsapp/phonenumbers')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              result: [{ displayPhoneNumber: '852-9000-0001' }],
            }),
            { status: 200 },
          ),
        );
      }
      if (url.includes('webhookEndpoints') && init?.method === 'GET') {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 }),
        );
      }
      if (url.includes('webhookEndpoints') && init?.method === 'POST') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: false,
              error: 'Number of Webhooks exceed limitation',
              isOverWebhookLimit: true,
            }),
            { status: 400 },
          ),
        );
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    });

    await expect(client.registerWebhookForPhone('85290000001', webhookUrl)).rejects.toMatchObject({
      name: 'WatiApiError',
      status: 409,
    });
  });

  it('succeeds when webhook limit response matches an existing endpoint', async () => {
    const webhookUrl = 'http://localhost:3010/api/agent/webhooks/wati/85290000001';

    fetchSpy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('whatsapp/phonenumbers')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              result: [{ displayPhoneNumber: '852-9000-0001' }],
            }),
            { status: 200 },
          ),
        );
      }
      if (url.includes('webhookEndpoints') && init?.method === 'GET') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              result: [
                {
                  channelPhoneNumber: '852-9000-0001',
                  url: webhookUrl,
                },
              ],
            }),
            { status: 200 },
          ),
        );
      }
      if (url.includes('webhookEndpoints') && init?.method === 'POST') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: false,
              error: 'Number of Webhooks exceed limitation',
              isOverWebhookLimit: true,
            }),
            { status: 400 },
          ),
        );
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    });

    const result = await client.registerWebhookForPhone('85290000001', webhookUrl);

    expect(result.ok).toBe(true);
    expect(result.result?.[0]?.url).toBe(webhookUrl);
  });

  it('throws when webhook limit in HTTP 200 body does not match a registered endpoint', async () => {
    const webhookUrl = 'http://localhost:3010/api/agent/webhooks/wati/85290000001';

    fetchSpy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('whatsapp/phonenumbers')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              result: [{ displayPhoneNumber: '852-9000-0001' }],
            }),
            { status: 200 },
          ),
        );
      }
      if (url.includes('webhookEndpoints') && init?.method === 'GET') {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 }),
        );
      }
      if (url.includes('webhookEndpoints') && init?.method === 'POST') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: false,
              error: 'Number of Webhooks exceed limitation',
              isOverWebhookLimit: true,
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    });

    await expect(client.registerWebhookForPhone('85290000001', webhookUrl)).rejects.toMatchObject({
      name: 'WatiApiError',
      status: 409,
    });
  });

  it('throws when webhook already exists response does not match a registered endpoint', async () => {
    const webhookUrl = 'https://tunnel.example.test/api/agent/webhooks/wati/15550001234';

    fetchSpy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('whatsapp/phonenumbers')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              result: [{ displayPhoneNumber: '15550001234' }],
            }),
            { status: 200 },
          ),
        );
      }
      if (url.includes('webhookEndpoints') && init?.method === 'GET') {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 }),
        );
      }
      if (url.includes('webhookEndpoints') && init?.method === 'POST') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: 'Webhook URL already exists',
              isWebhookExist: true,
              ok: false,
              phoneNumbers: ['15550001234'],
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    });

    await expect(client.registerWebhookForPhone('15550001234', webhookUrl)).rejects.toMatchObject({
      name: 'WatiApiError',
      status: 409,
    });
  });
});
