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
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('whatsapp/phonenumbers')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              result: [{ displayPhoneNumber: '852-5333-2683' }],
            }),
            { status: 200 },
          ),
        );
      }
      if (url.includes('webhookEndpoints')) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    });

    await client.registerWebhookForPhone(
      '85253332683',
      'http://localhost:3010/api/agent/webhooks/wati/85253332683',
    );

    const webhookCall = fetchSpy.mock.calls.find(([url]) =>
      String(url).includes('webhookEndpoints'),
    );
    const [, init] = webhookCall as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body[0].phoneNumber).toBe('852-5333-2683');
  });
});
