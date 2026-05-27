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

describe('WatiApiClient.upsertWebhookEndpoints', () => {
  it('POSTs enabled message webhook to v2 webhookEndpoints', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: [{ url: 'http://localhost/webhook' }] }), {
        status: 200,
      }),
    );

    await client.upsertWebhookEndpoints([
      {
        phoneNumber: '85253332683',
        url: 'http://localhost:3010/api/agent/webhooks/wati/85253332683',
      },
    ]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://live-mt-server.wati.io/tenant-test/api/v2/webhookEndpoints');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer bearer-test');

    const body = JSON.parse(init.body as string);
    expect(body).toEqual([
      {
        eventTypes: ['message'],
        phoneNumber: '85253332683',
        status: 1,
        url: 'http://localhost:3010/api/agent/webhooks/wati/85253332683',
      },
    ]);
  });
});
