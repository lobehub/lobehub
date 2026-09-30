import type { Server } from 'node:http';
import { createServer } from 'node:http';
import { inspect } from 'node:util';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deliverWebhook, executeToolCallWebhook } from '../httpWebhook';

vi.mock('@/libs/qstash', () => ({ OtelQstashClient: class {} }));

/** Real socket tests: no fetch mocks. */
describe('HTTP hook network boundary', () => {
  let server: Server;
  let base: string;
  let requests: string[];
  beforeEach(async () => {
    requests = [];
    server = createServer((req, res) => {
      requests.push(req.url!);
      if (req.url === '/redirect') {
        res.writeHead(302, { Location: `${base}/leaked` });
        res.end();
      } else if (req.url === '/allow' || req.url === '/deny') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify(
            req.url === '/allow'
              ? { decision: 'allow' }
              : { decision: 'deny', reason: '禁止执行该操作' },
          ),
        );
      } else if (req.url?.startsWith('/disconnect')) {
        req.socket.destroy();
      } else if (req.url === '/large') {
        res.writeHead(200);
        res.end('x'.repeat(100_000));
      } else if (req.url === '/slow') {
        res.writeHead(200);
        res.write('{');
      } else {
        res.writeHead(204);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server address');
    base = `http://127.0.0.1:${address.port}`;
    vi.stubEnv('SSRF_ALLOW_PRIVATE_IP_ADDRESS', undefined);
    vi.stubEnv('SSRF_ALLOW_IP_ADDRESS_LIST', undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  const config = (url: string) => ({ responseHandling: 'toolCall' as const, url });
  it.each(['INTERNAL_APP_URL', 'APP_URL'])(
    'delivers relative hooks through %s without private-network overrides',
    async (variable) => {
      vi.stubEnv('INTERNAL_APP_URL', undefined);
      vi.stubEnv('APP_URL', undefined);
      vi.stubEnv(variable, base);
      vi.stubEnv('QSTASH_TOKEN', undefined);
      await expect(deliverWebhook({ url: '/hook' }, {})).resolves.toBeUndefined();
      await expect(
        deliverWebhook({ url: '/hook', delivery: 'qstash' }, {}),
      ).resolves.toBeUndefined();
      expect(requests).toEqual(['/hook', '/hook']);
    },
  );
  it.each(['allow', 'deny'] as const)('parses a flat %s over real HTTP', async (decision) => {
    expect(await executeToolCallWebhook(config(`${base}/${decision}`), {})).toEqual({
      status: 'success',
      decision: decision === 'allow' ? { decision } : { decision, reason: '禁止执行该操作' },
    });
    expect(requests).toEqual([`/${decision}`]);
  });
  it('rejects 204 for control but accepts it for notification', async () => {
    expect(await executeToolCallWebhook(config(`${base}/hook`), {})).toEqual({
      status: 'error',
      code: 'invalid_response',
    });
    await expect(deliverWebhook({ url: `${base}/hook` }, {})).resolves.toBeUndefined();
    expect(requests).toEqual(['/hook', '/hook']);
  });
  it('does not log query credentials when the connection fails', async () => {
    const logger = vi.mocked(console.error);
    expect(
      await executeToolCallWebhook(config(`${base}/disconnect?signature=TEST_QUERY_SECRET`), {}),
    ).toEqual({ code: 'network_error', status: 'error' });
    expect(inspect(logger.mock.calls)).not.toContain('TEST_QUERY_SECRET');
  });
  it.each(['/large', '/slow'])('ignores successful notification bodies at %s', async (path) => {
    await expect(
      deliverWebhook({ url: `${base}${path}`, fallback: 'none', timeout: 0.5 }, {}),
    ).resolves.toBeUndefined();
    expect(requests).toEqual([path]);
  });
  it.each(['/large', '/slow'])('ignores successful fetch fallback bodies at %s', async (path) => {
    vi.stubEnv('QSTASH_TOKEN', undefined);
    await expect(
      deliverWebhook({ url: `${base}${path}`, delivery: 'qstash', timeout: 0.5 }, {}),
    ).resolves.toBeUndefined();
    expect(requests).toEqual([path]);
  });
  it('never forwards auth to a redirect target', async () => {
    expect(
      await executeToolCallWebhook(
        { ...config(`${base}/redirect`), headers: { Authorization: 'test-only' } },
        {},
      ),
    ).toMatchObject({ status: 'error' });
    expect(requests).toEqual(['/redirect']);
  });
  it('rejects oversized bodies and bounds body-read time', async () => {
    expect(await executeToolCallWebhook(config(`${base}/large`), {})).toEqual({
      status: 'error',
      code: 'response_too_large',
    });
    expect(await executeToolCallWebhook({ ...config(`${base}/slow`), timeout: 0.03 }, {})).toEqual({
      status: 'error',
      code: 'timeout',
    });
  });
});
