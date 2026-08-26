import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { startProviderBindingProxy } from './providerBindingProxy';

interface CapturedRequest {
  body: string;
  headers: IncomingHttpHeaders;
  method?: string;
  url?: string;
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const startUpstream = async () => {
  const requests: CapturedRequest[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      let body = '';
      for await (const chunk of request) body += chunk.toString();
      requests.push({ body, headers: request.headers, method: request.method, url: request.url });
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'x-upstream': 'yes',
      });
      response.write('data: first\n\n');
      response.end('data: [DONE]\n\n');
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  );
  return { origin: `http://127.0.0.1:${address.port}`, requests };
};

describe('startProviderBindingProxy', () => {
  it('relays OpenAI chat requests while keeping the upstream key out of the client', async () => {
    const upstream = await startUpstream();
    const proxy = await startProviderBindingProxy({
      apiKey: 'upstream-openai-secret',
      endpoint: `${upstream.origin}/openai/v1/`,
      protocol: 'openai-chat-completions',
    });
    cleanups.push(proxy.close);

    const response = await fetch(`${proxy.endpoint}/chat/completions?preview=true`, {
      body: JSON.stringify({ model: 'gpt-test' }),
      headers: {
        'authorization': `Bearer ${proxy.clientApiKey}`,
        'content-type': 'application/json',
      },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('x-upstream')).toBe('yes');
    expect(await response.text()).toBe('data: first\n\ndata: [DONE]\n\n');
    expect(upstream.requests).toHaveLength(1);
    expect(upstream.requests[0]).toMatchObject({
      body: '{"model":"gpt-test"}',
      method: 'POST',
      url: '/openai/v1/chat/completions?preview=true',
    });
    expect(upstream.requests[0].headers.authorization).toBe('Bearer upstream-openai-secret');
    expect(JSON.stringify(upstream.requests[0])).not.toContain(proxy.clientApiKey);
  });

  it('normalizes Anthropic endpoints and replaces x-api-key authentication', async () => {
    const upstream = await startUpstream();
    const proxy = await startProviderBindingProxy({
      apiKey: 'upstream-anthropic-secret',
      endpoint: `${upstream.origin}/anthropic/v1/messages`,
      protocol: 'anthropic-messages',
    });
    cleanups.push(proxy.close);

    const response = await fetch(`${proxy.endpoint}/v1/messages`, {
      body: JSON.stringify({ model: 'claude-test' }),
      headers: {
        'content-type': 'application/json',
        'x-api-key': proxy.clientApiKey,
      },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(upstream.requests[0].url).toBe('/anthropic/v1/messages');
    expect(upstream.requests[0].headers['x-api-key']).toBe('upstream-anthropic-secret');
    expect(upstream.requests[0].headers.authorization).toBeUndefined();
  });

  it('rejects invalid credentials and paths without contacting the provider', async () => {
    const upstream = await startUpstream();
    const proxy = await startProviderBindingProxy({
      apiKey: 'upstream-secret',
      endpoint: `${upstream.origin}/v1`,
      protocol: 'openai-chat-completions',
    });
    cleanups.push(proxy.close);

    const unauthorized = await fetch(`${proxy.endpoint}/chat/completions`, {
      body: '{}',
      headers: { authorization: 'Bearer wrong-key' },
      method: 'POST',
    });
    const wrongPath = await fetch(`${proxy.endpoint}/models`, {
      headers: { authorization: `Bearer ${proxy.clientApiKey}` },
      method: 'POST',
    });

    expect(unauthorized.status).toBe(401);
    expect(wrongPath.status).toBe(404);
    expect(upstream.requests).toEqual([]);
  });
});
