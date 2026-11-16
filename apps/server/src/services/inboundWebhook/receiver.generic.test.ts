// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InboundWebhookModel } from '@/database/models/inboundWebhook';
import { agents, signals, topics, users } from '@/database/schemas';
import {
  inboundWebhook,
  inboundWebhookBodyLimit,
} from '@/server/router-hono/webhooks/handlers/inbound';

import { receiverTestSecret, signedWebhookHeaders } from './receiverTestUtils';

const { countDelivery, gateKeeper, scheduleWake } = vi.hoisted(() => ({
  countDelivery: vi.fn<(id: string) => Promise<number | undefined>>(),
  gateKeeper: {
    encrypt: async (value: string) => `encrypted:${value}`,
    decrypt: async (value: string) => ({ plaintext: value.slice('encrypted:'.length) }),
  },
  scheduleWake: vi.fn<() => Promise<void>>(),
}));

vi.mock('@/server/utils/scheduleAfterResponse', () => ({
  afterUnscoped: (work: () => unknown) => void Promise.resolve().then(work),
}));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => db) }));
vi.mock('@/server/services/inboundWebhook/sweep', () => ({ scheduleInboundWebhookSweep: vi.fn() }));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => gateKeeper },
}));
vi.mock('@/server/services/redis', () => ({ redisService: { inboundWebhook: { countDelivery } } }));
vi.mock('@/server/services/inboundWebhook/scheduler', () => ({
  scheduleInboundWebhookWake: scheduleWake,
}));
vi.mock('./kinds/mcpEvents/subscription', () => ({
  maintainMcpSubscription: vi.fn(),
  teardownMcpSubscription: vi.fn(),
}));

const db = await getTestDB();
const userId = 'generic-receiver-user';
const agentId = 'generic-receiver-agent';
const topicId = 'generic-receiver-topic';
const token = 'generic-token-0123456789';
const model = new InboundWebhookModel(db, userId, undefined, gateKeeper);
// The one route production mounts: the key travels in a header, never in the URL.
const app = new Hono().post('/inbound/:id', inboundWebhookBodyLimit, inboundWebhook);
const auth = { authorization: `Bearer ${token}` };

const seed = (status: 'active' | 'paused' = 'active') =>
  model.create({
    agentId,
    config: { autoApprove: false, topicMode: 'new' },
    kind: 'generic',
    secret: token,
    status,
    verification: { scheme: 'bearer_token' },
  });
const post = (path: string, init: RequestInit = {}) =>
  app.request(path, { method: 'POST', ...init });
const stored = () => db.select().from(signals).where(eq(signals.userId, userId));

beforeEach(async () => {
  vi.clearAllMocks();
  countDelivery.mockResolvedValue(1);
  scheduleWake.mockResolvedValue(undefined);
  await db.delete(users);
  await db.insert(users).values({ id: userId });
  await db.insert(agents).values({ id: agentId, userId });
  await db.insert(topics).values({ agentId, id: topicId, userId });
});
afterEach(async () => {
  await db.delete(users);
});

describe('generic webhook ingress', () => {
  it('accepts a JSON call with the key, stores it once and schedules a wake', async () => {
    const row = await seed();
    const response = await post(`/inbound/${row.id}?source=ci`, {
      body: JSON.stringify({ build: 42 }),
      headers: { ...auth, 'content-type': 'application/json', 'x-github-event': 'push' },
    });
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toEqual({ id: expect.any(String), status: 'accepted' });

    const [signal] = await stored();
    expect(signal).toMatchObject({
      externalId: expect.stringMatching(new RegExp(`^${row.id}:`)),
      id: body.id,
      scopeKey: `inbound-webhook:${row.id}`,
      source: 'webhook',
      status: 'pending',
      type: 'webhook',
    });
    expect(signal.payload).toEqual({
      body: { build: 42 },
      headers: { 'content-type': 'application/json', 'x-github-event': 'push' },
      query: { source: 'ci' },
    });
    await vi.waitFor(() => expect(scheduleWake).toHaveBeenCalledWith(row.id));
    expect((await model.findById(row.id))?.lastDeliveryAt).toBeInstanceOf(Date);
  });

  it('keeps the key out of what the Agent reads', async () => {
    const row = await seed();
    const response = await post(`/inbound/${row.id}`, {
      body: 'disk almost full',
      headers: { ...auth, 'content-type': 'text/plain' },
    });
    expect(response.status).toBe(202);
    expect((await stored())[0].payload.body).toBe('disk almost full');
    // The credential never reaches what the Agent reads.
    expect(JSON.stringify((await stored())[0].payload)).not.toContain(token);
  });

  it.each([
    [
      'a wrong key',
      401,
      (id: string) => post(`/inbound/${id}`, { headers: { authorization: 'Bearer nope' } }),
    ],
    ['no key at all', 401, (id: string) => post(`/inbound/${id}`)],
    // There is no secret URL: a key in the path reaches no route.
    [
      'the key in the URL instead of the header',
      404,
      (id: string) => post(`/inbound/${id}/${token}`),
    ],
  ] as const)('refuses %s without storing anything', async (_, status, call) => {
    const row = await seed();
    expect((await call(row.id)).status).toBe(status);
    expect(await stored()).toHaveLength(0);
    expect(countDelivery).not.toHaveBeenCalled();
  });

  it('never lets a bearer key stand in for an MCP signature', async () => {
    const row = await model.create({
      agentId,
      config: { arguments: {}, eventName: 'issue.created' },
      kind: 'mcp_events',
      secret: receiverTestSecret,
      status: 'active',
      topicId,
      verification: { scheme: 'standard_webhooks' },
    });
    const body = JSON.stringify({
      data: {},
      eventId: 'e1',
      name: 'issue.created',
      timestamp: '2026-11-13T08:00:00Z',
    });
    expect(
      (
        await post(`/inbound/${row.id}`, {
          body,
          headers: { authorization: `Bearer ${receiverTestSecret}` },
        })
      ).status,
    ).toBe(401);
    // Signed, the same delivery is accepted: only the signature counts for MCP Events.
    const headers = signedWebhookHeaders(body, { id: 'delivery-1' });
    expect((await post(`/inbound/${row.id}`, { body, headers })).status).not.toBe(401);
  });

  it('answers a repeated Idempotency-Key with the first delivery instead of a second one', async () => {
    const row = await seed();
    const call = () =>
      post(`/inbound/${row.id}`, {
        body: '{"n":1}',
        headers: { ...auth, 'content-type': 'application/json', 'idempotency-key': 'job-7' },
      });
    const first = await (await call()).json();
    const second = await call();
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ duplicate: true, id: first.id });
    expect(await stored()).toHaveLength(1);
  });

  it('refuses calls while paused, without storing them', async () => {
    const row = await seed('paused');
    const response = await post(`/inbound/${row.id}`, { body: '{}', headers: auth });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'Webhook is paused' });
    expect(await stored()).toHaveLength(0);
  });

  it('rate-limits a caller over 120 calls a minute before storing anything', async () => {
    const row = await seed();
    countDelivery.mockResolvedValue(121);
    const response = await post(`/inbound/${row.id}`, { body: '{}', headers: auth });
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(await stored()).toHaveLength(0);
  });

  it('keeps the thread key with the delivery and rejects one that is too long', async () => {
    const row = await seed();
    expect(
      (await post(`/inbound/${row.id}?thread=ticket-42`, { body: '{}', headers: auth })).status,
    ).toBe(202);
    expect((await stored())[0].metadata.address).toEqual({
      threadKey: 'ticket-42',
      webhookId: row.id,
    });
    const long = 'x'.repeat(201);
    expect(
      (await post(`/inbound/${row.id}?thread=${long}`, { body: '{}', headers: auth })).status,
    ).toBe(400);
  });

  it('refuses file uploads and malformed JSON', async () => {
    const row = await seed();
    const form = new FormData();
    form.set('file', new Blob(['x']), 'x.txt');
    expect((await post(`/inbound/${row.id}`, { body: form, headers: auth })).status).toBe(415);
    expect(
      (
        await post(`/inbound/${row.id}`, {
          body: '{oops',
          headers: { ...auth, 'content-type': 'application/json' },
        })
      ).status,
    ).toBe(400);
    expect(await stored()).toHaveLength(0);
  });
});
