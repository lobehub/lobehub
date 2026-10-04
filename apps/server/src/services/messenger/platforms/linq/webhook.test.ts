// @vitest-environment node
import { signLinqWebhookPayload } from '@lobechat/agent-address-linq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { linqWebhookGate } from './webhook';

const SECRET = `whsec_${Buffer.from('linq-test-secret').toString('base64')}`;

const config = vi.hoisted(() => ({ value: null as null | Record<string, unknown> }));

vi.mock('@/config/messenger', () => ({
  getMessengerLinqConfig: vi.fn(async () => config.value),
}));

// No Redis in unit tests — the gate falls back to its in-memory replay store.
vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: vi.fn(() => null),
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
});
