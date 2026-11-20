// @vitest-environment node
import { signLinqWebhookPayload } from '@lobechat/agent-address-linq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { linqWebhookGate } from './webhook';

const SECRET = `whsec_${Buffer.from('linq-test-secret').toString('base64')}`;

const config = vi.hoisted(() => ({ value: null as null | Record<string, unknown> }));

vi.mock('@/config/messenger', () => ({
  getMessengerLinqConfig: vi.fn(async () => config.value),
}));

const redisStore = vi.hoisted(() => new Map<string, string>());

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: vi.fn(() => ({
    del: vi.fn(async (key: string) => (redisStore.delete(key) ? 1 : 0)),
    set: vi.fn(async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && redisStore.has(key)) return null;
      redisStore.set(key, value);
      return 'OK';
    }),
  })),
}));

const ctx = { invalidateBot: vi.fn() };

const signed = (body: string, id: string, secret = SECRET) => {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return new Request('https://app.test/api/agent/messenger/webhooks/linq', {
    body,
    headers: {
      'webhook-id': id,
      'webhook-signature': signLinqWebhookPayload({ body, id, secret, timestamp }),
      'webhook-timestamp': timestamp,
    },
    method: 'POST',
  });
};

const body = JSON.stringify({ data: { id: 'msg_1' }, event_type: 'message.received' });

beforeEach(() => {
  config.value = { apiKey: 'linq_test', numbers: ['+15550000001'], webhookSecret: SECRET };
});

describe('linqWebhookGate', () => {
  it('lets a correctly signed delivery through to the router', async () => {
    const req = signed(body, `evt_${Math.random()}`);
    expect(await linqWebhookGate.preprocess(req, body, ctx)).toBeNull();
  });

  it('rejects a delivery signed with another secret before touching anything', async () => {
    const other = `whsec_${Buffer.from('not-the-secret').toString('base64')}`;
    const res = await linqWebhookGate.preprocess(signed(body, 'evt_forged', other), body, ctx);
    expect(res?.status).toBe(401);
  });

  it('answers a replayed delivery id as a duplicate', async () => {
    const id = `evt_${Math.random()}`;
    expect(await linqWebhookGate.preprocess(signed(body, id), body, ctx)).toBeNull();
    const res = await linqWebhookGate.preprocess(signed(body, id), body, ctx);
    expect(res?.status).toBe(409);
  });

  it('is unavailable until the deployment configures the pool', async () => {
    config.value = null;
    const res = await linqWebhookGate.preprocess(signed(body, 'evt_x'), body, ctx);
    expect(res?.status).toBe(503);
  });

  it.each([
    ['the router answered 503', new Response('bot unavailable', { status: 503 })],
    ['the install was not found', new Response('install not found', { status: 404 })],
    ['handling threw', undefined],
  ])('releases the claim so a retry is processed when %s', async (_label, response) => {
    const id = `evt_${Math.random()}`;
    expect(await linqWebhookGate.preprocess(signed(body, id), body, ctx)).toBeNull();

    await linqWebhookGate.settle!(signed(body, id), response);

    expect(await linqWebhookGate.preprocess(signed(body, id), body, ctx)).toBeNull();
  });

  it('keeps the claim after a successful delivery', async () => {
    const id = `evt_${Math.random()}`;
    expect(await linqWebhookGate.preprocess(signed(body, id), body, ctx)).toBeNull();

    await linqWebhookGate.settle!(signed(body, id), Response.json({ ok: true }));

    const res = await linqWebhookGate.preprocess(signed(body, id), body, ctx);
    expect(res?.status).toBe(409);
  });
});
