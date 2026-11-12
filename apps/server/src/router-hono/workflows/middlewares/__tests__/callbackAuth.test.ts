import { createHash } from 'node:crypto';

import { Receiver } from '@upstash/qstash';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OtelQstashClient, verifyQStashSignature } from '@/libs/qstash';
import { signInternalCallback } from '@/libs/qstash/internalSignature';
import { deliverWebhook } from '@/server/services/agentRuntime/hooks/httpWebhook';

import { qstashAuth as agentAuth } from '../../../agent/middlewares/qstashAuth';
import { qstashAuth, workflowAuth } from '../qstashAuth';

const desktop = vi.hoisted(() => ({ isDesktop: false }));
vi.mock('@lobechat/const', () => ({
  get isDesktop() {
    return desktop.isDesktop;
  },
}));
vi.mock('@lobechat/observability-otel/modules/upstash-workflow', () => ({
  recordUpstashWorkflowEvent: vi.fn(),
}));

const url = 'https://app.example/api/workflows/test';
const body = JSON.stringify({ operationId: 'synthetic-operation' });
const makeApp = (auth = qstashAuth) =>
  new Hono().post('*', auth(), async (c) => c.json(await c.req.json()));

describe('callback authentication across HTTP delivery and Hono', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('QSTASH_CURRENT_SIGNING_KEY', '');
    vi.stubEnv('QSTASH_NEXT_SIGNING_KEY', '');
    vi.stubEnv('QSTASH_TOKEN', '');
    vi.stubEnv('KEY_VAULTS_SECRET', 'synthetic-test-secret');
    vi.stubEnv('APP_URL', 'https://app.example');
    vi.stubEnv('INTERNAL_APP_URL', '');
    desktop.isDesktop = false;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    ['workflow', qstashAuth],
    ['agent', agentAuth],
  ] as const)('rejects unsigned production %s callbacks without signing keys', async (_, auth) => {
    expect((await makeApp(auth).request(url, { body, method: 'POST' })).status).toBe(401);
  });

  it.each([
    ['workflow', qstashAuth],
    ['agent', agentAuth],
  ] as const)(
    'delivers a signed internal %s notification and preserves its JSON body',
    async (_, auth) => {
      const app = makeApp(auth);
      let payload: unknown;
      let received: Response | undefined;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (target: string, init: RequestInit) => {
          expect(new Headers(init.headers).get('x-lobe-callback-signature')).toBeTruthy();
          received = await app.request(target, init);
          payload = await received.json();
          return new Response(null, { status: received.status });
        }),
      );
      await deliverWebhook({ url }, JSON.parse(body));
      expect(received?.status).toBe(200);
      expect(payload).toEqual(JSON.parse(body));
    },
  );

  it('signs the direct fallback with the internal signature when QStash is configured', async () => {
    vi.stubEnv('QSTASH_CURRENT_SIGNING_KEY', 'current-test-key');
    vi.stubEnv('QSTASH_NEXT_SIGNING_KEY', 'next-test-key');
    vi.stubEnv('QSTASH_TOKEN', 'test-token');
    const publish = vi
      .spyOn(OtelQstashClient.prototype, 'publishJSON')
      .mockRejectedValue(new Error('qstash unavailable'));
    const app = makeApp();
    let received: Response | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (target: string, init: RequestInit) => {
        expect(new Headers(init.headers).get('x-lobe-callback-signature')).toBeTruthy();
        received = await app.request(target, init);
        return new Response(null, { status: received.status });
      }),
    );
    await deliverWebhook({ delivery: 'qstash', url }, JSON.parse(body));
    expect(publish).toHaveBeenCalledTimes(1);
    expect(received?.status).toBe(200);
  });

  it('does not authenticate callbacks sent to a different origin', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (target: string, init: RequestInit) => {
        expect(await verifyQStashSignature(new Request(target, init), body)).toBe(false);
        return new Response(null, { status: 204 });
      }),
    );
    await deliverWebhook({ url: 'https://other.example/api/workflows/test' }, JSON.parse(body));
  });

  it.each(['development', 'desktop'])(
    'keeps %s callbacks available without QStash',
    async (mode) => {
      if (mode === 'development') vi.stubEnv('NODE_ENV', 'development');
      else desktop.isDesktop = true;
      expect(await verifyQStashSignature(new Request(url), body)).toBe(true);
    },
  );

  it('keeps configured QStash verification and rejects missing or invalid signatures', async () => {
    vi.stubEnv('QSTASH_CURRENT_SIGNING_KEY', 'current-test-key');
    vi.stubEnv('QSTASH_NEXT_SIGNING_KEY', 'next-test-key');
    const verify = vi.spyOn(Receiver.prototype, 'verify').mockResolvedValue(true);
    expect(
      await verifyQStashSignature(
        new Request(url, { headers: { 'Upstash-Signature': 'signed' } }),
        body,
      ),
    ).toBe(true);
    expect(verify).toHaveBeenCalledWith({ body, signature: 'signed' });
    expect(await verifyQStashSignature(new Request(url), body)).toBe(false);
    verify.mockRejectedValue(new Error('invalid signature'));
    expect(
      await verifyQStashSignature(
        new Request(url, { headers: { 'Upstash-Signature': 'bad' } }),
        body,
      ),
    ).toBe(false);
  });
  it.each(['current-test-key', 'next-test-key'])(
    'accepts real QStash JWTs signed with %s',
    async (key) => {
      vi.stubEnv('QSTASH_CURRENT_SIGNING_KEY', 'current-test-key');
      vi.stubEnv('QSTASH_NEXT_SIGNING_KEY', 'next-test-key');
      const signature = await new SignJWT({
        body: createHash('sha256').update(body).digest('base64url'),
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer('Upstash')
        .setSubject(url)
        .setExpirationTime('5m')
        .sign(new TextEncoder().encode(key));
      const request = new Request(url, {
        body,
        method: 'POST',
        headers: { 'Upstash-Signature': signature },
      });
      expect(await verifyQStashSignature(request, body)).toBe(true);
      expect(await verifyQStashSignature(request, '{}')).toBe(false);
    },
  );

  it('accepts a valid internal signature alongside configured QStash keys', async () => {
    vi.stubEnv('QSTASH_CURRENT_SIGNING_KEY', 'current-test-key');
    vi.stubEnv('QSTASH_NEXT_SIGNING_KEY', 'next-test-key');
    const headers = signInternalCallback(url, body);
    expect(headers['x-lobe-callback-signature']).toBeTruthy();
    expect(
      await verifyQStashSignature(new Request(url, { body, headers, method: 'POST' }), body),
    ).toBe(true);
  });

  it.each(['body', 'forged', 'expired'])(
    'rejects an internal signature with %s changed when QStash is configured',
    async (change) => {
      vi.stubEnv('QSTASH_CURRENT_SIGNING_KEY', 'current-test-key');
      vi.stubEnv('QSTASH_NEXT_SIGNING_KEY', 'next-test-key');
      const headers = signInternalCallback(url, body);
      let content = body;
      if (change === 'body') content = '{}';
      if (change === 'forged') {
        headers['x-lobe-callback-signature'] = `${Date.now()}.${'0'.repeat(64)}`;
      }
      if (change === 'expired') vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 301_000);
      expect(
        await verifyQStashSignature(
          new Request(url, { body: content, headers, method: 'POST' }),
          content,
        ),
      ).toBe(false);
    },
  );

  it.each(['body', 'path', 'method', 'expired', 'missing-secret', 'malformed', 'partial-qstash'])(
    'rejects an internal callback with %s changed',
    async (change) => {
      const headers = signInternalCallback(url, body);
      let target = url;
      let content = body;
      let method = 'POST';
      if (change === 'body') content = '{}';
      if (change === 'path') target += '-other';
      if (change === 'method') method = 'PUT';
      if (change === 'expired') vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 301_000);
      if (change === 'missing-secret') vi.stubEnv('KEY_VAULTS_SECRET', '');
      if (change === 'malformed') headers['x-lobe-callback-signature'] = 'invalid';
      if (change === 'partial-qstash') vi.stubEnv('QSTASH_CURRENT_SIGNING_KEY', 'current-test-key');
      expect(
        await verifyQStashSignature(
          new Request(target, { body: content, headers, method }),
          content,
        ),
      ).toBe(false);
    },
  );

  it('guards unsigned SDK workflows and preserves the raw body for authenticated workflows', async () => {
    const app = new Hono()
      .use('*', workflowAuth())
      .post('*', async (c) => c.text(await c.req.raw.text()));
    expect((await app.request(url, { body, method: 'POST' })).status).toBe(401);
    const result = await app.request(url, {
      body,
      headers: signInternalCallback(url, body),
      method: 'POST',
    });
    expect(result.status).toBe(200);
    expect(await result.text()).toBe(body);
  });

  it('leaves configured SDK workflow verification to the SDK', async () => {
    vi.stubEnv('QSTASH_CURRENT_SIGNING_KEY', 'current-test-key');
    vi.stubEnv('QSTASH_NEXT_SIGNING_KEY', 'next-test-key');
    const app = new Hono()
      .use('*', workflowAuth())
      .post('*', (c) => c.text('SDK verification boundary'));
    expect(await (await app.request(url, { body, method: 'POST' })).text()).toBe(
      'SDK verification boundary',
    );
  });
});
