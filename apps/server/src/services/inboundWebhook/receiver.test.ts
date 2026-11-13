// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InboundWebhookModel } from '@/database/models/inboundWebhook';
import { agents, inboundWebhooks, signals, topics, users } from '@/database/schemas';
import {
  inboundWebhook,
  inboundWebhookBodyLimit,
} from '@/server/router-hono/webhooks/handlers/inbound';

import { receiverTestSecret, signedWebhookHeaders } from './receiverTestUtils';

const { claims, gateKeeper, scheduleWake, scheduled } = vi.hoisted(() => ({
  claims: new Set<string>(),
  scheduled: [] as Promise<unknown>[],
  gateKeeper: {
    encrypt: async (value: string) => `encrypted:${value}`,
    decrypt: async (value: string) => ({ plaintext: value.slice('encrypted:'.length) }),
  },
  scheduleWake: vi.fn<() => Promise<void>>(),
}));

vi.mock('@/server/utils/scheduleAfterResponse', () => ({
  // Start deferred work immediately for observability, without waiting on it in the HTTP flow.
  afterUnscoped: (work: () => Promise<unknown> | unknown) => {
    scheduled.push(
      Promise.resolve()
        .then(work)
        .catch((error) => {
          console.error('[receiver:test] Deferred work failed', error);
        }),
    );
  },
}));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => db) }));
vi.mock('@/server/services/inboundWebhook/sweep', () => ({ scheduleInboundWebhookSweep: vi.fn() }));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => gateKeeper },
}));
vi.mock('@/server/services/redis', () => ({
  redisService: {
    inboundWebhook: {
      claimDelivery: async (id: string, deliveryId: string) => {
        const key = `${id}:${deliveryId}`;
        if (claims.has(key)) return false;
        claims.add(key);
        return true;
      },
      releaseDelivery: async (id: string, deliveryId: string) => {
        claims.delete(`${id}:${deliveryId}`);
      },
    },
  },
}));
vi.mock('@/server/services/inboundWebhook/waker', () => ({
  scheduleInboundWebhookWake: scheduleWake,
}));
// Receiver integration exercises actual kind parsing while isolating remote connection maintenance.
vi.mock('./kinds/mcpEvents/subscription', () => ({
  maintainMcpSubscription: vi.fn(),
  teardownMcpSubscription: vi.fn(),
}));

const db = await getTestDB();
const userId = 'inbound-receiver-user';
const agentId = 'inbound-receiver-agent';
const topicId = 'inbound-receiver-topic';
const model = new InboundWebhookModel(db, userId, undefined, gateKeeper);
const app = new Hono().post('/inbound/:id', inboundWebhookBodyLimit, inboundWebhook);
const event = (overrides = {}) => ({
  cursor: 'cursor-1',
  data: { number: 12, message: '你好' },
  eventId: 'event-1',
  name: 'issue.created',
  timestamp: '2026-11-13T08:00:00Z',
  ...overrides,
});
const seed = async (status: 'active' | 'pending' | 'terminated' | 'deleting' = 'active') =>
  model.create({
    agentId,
    topicId,
    kind: 'mcp_events',
    config: { arguments: {}, eventName: 'issue.created' },
    secret: receiverTestSecret,
    status,
    verification: { scheme: 'standard_webhooks' },
  });
const deliver = (
  id: string,
  payload: unknown,
  options: { deliveryId?: string; headers?: Headers; rawBody?: string } = {},
) => {
  const body = options.rawBody ?? JSON.stringify(payload);
  return app.request(`/inbound/${id}`, {
    method: 'POST',
    body,
    headers: options.headers ?? signedWebhookHeaders(body, { id: options.deliveryId }),
  });
};

beforeEach(async () => {
  claims.clear();
  scheduled.length = 0;
  scheduleWake.mockReset().mockResolvedValue(undefined);
  await db.delete(users);
  await db.insert(users).values({ id: userId });
  await db.insert(agents).values({ id: agentId, userId });
  await db.insert(topics).values({ id: topicId, userId, agentId });
});
afterEach(async () => {
  await Promise.all(scheduled);
  vi.restoreAllMocks();
  await db.delete(users);
});

describe('inbound webhook receiving with real persistence', () => {
  it('returns 410 for removed endpoints and deleting rows', async () => {
    expect((await deliver('00000000-0000-0000-0000-000000000000', event())).status).toBe(410);
    const row = await seed('deleting');
    expect((await deliver(row.id, event())).status).toBe(410);
    expect(await db.select().from(signals)).toEqual([]);
  });

  it('treats a malformed endpoint id as gone without a database UUID error', async () => {
    expect((await deliver('not-a-uuid', event())).status).toBe(410);
  });

  it('returns 410 for unknown kinds instead of throwing', async () => {
    const row = await seed();
    await db
      .update(inboundWebhooks)
      .set({ kind: 'unknown' as never })
      .where(eq(inboundWebhooks.id, row.id));
    expect((await deliver(row.id, event())).status).toBe(410);
  });

  it('rejects oversized UTF-8 bodies before signature or persistence', async () => {
    const row = await seed();
    const body = JSON.stringify({ data: '界'.repeat(90_000) });
    expect(body.length).toBeLessThan(256 * 1024);
    expect((await deliver(row.id, {}, { rawBody: body })).status).toBe(413);
    expect(await db.select().from(signals)).toEqual([]);
    expect(claims.size).toBe(0);
  });

  it('returns 401 for invalid signatures and expired deliveries', async () => {
    const row = await seed();
    const body = JSON.stringify(event());
    const wrongKey = signedWebhookHeaders(body, {
      secret: `whsec_${Buffer.alloc(32, 43).toString('base64')}`,
    });
    expect((await deliver(row.id, event(), { headers: wrongKey })).status).toBe(401);
    const expired = signedWebhookHeaders(body, { timestamp: Math.floor(Date.now() / 1000) - 301 });
    expect((await deliver(row.id, event(), { headers: expired })).status).toBe(401);
    expect(await db.select().from(signals)).toEqual([]);
    expect(claims.size).toBe(0);
  });

  it('accepts verification on pending and active rows, including repeated challenges', async () => {
    const row = await seed('pending');
    const payload = { type: 'verification', challenge: 'prove-control' };
    const headers = signedWebhookHeaders(JSON.stringify(payload));
    headers.set('x-mcp-subscription-id', 'remote-subscription');
    const pending = await deliver(row.id, payload, { headers });
    expect(pending.status).toBe(200);
    expect(await pending.json()).toEqual({ challenge: 'prove-control' });
    expect((await model.findById(row.id))?.state.remoteSubscriptionId).toBe('remote-subscription');
    await model.update(row.id, { status: 'active' });
    const active = await deliver(row.id, payload, { headers });
    expect(active.status).toBe(200);
    expect(await active.json()).toEqual({ challenge: 'prove-control' });
    expect(await db.select().from(signals)).toEqual([]);
    expect(scheduleWake).not.toHaveBeenCalled();
  });

  it('returns 503 while pending, allowing the same delivery once subscription activates', async () => {
    const row = await seed('pending');
    expect((await deliver(row.id, event())).status).toBe(503);
    expect(await db.select().from(signals)).toEqual([]);
    await model.update(row.id, { status: 'active' });
    expect((await deliver(row.id, event())).status).toBe(200);
    expect(await db.select().from(signals)).toHaveLength(1);
  });

  it('returns 410 for events on terminated subscriptions', async () => {
    const row = await seed('terminated');
    expect((await deliver(row.id, event())).status).toBe(410);
    expect(await db.select().from(signals)).toEqual([]);
  });

  it('persists a new event in its user-scoped ledger before scheduling a wake', async () => {
    const row = await seed();
    let persistedWhenScheduled: number | undefined;
    scheduleWake.mockImplementation(async () => {
      persistedWhenScheduled = (await db.select().from(signals)).length;
    });
    expect((await deliver(row.id, event())).status).toBe(200);
    const [signal] = await db.select().from(signals);
    expect(signal).toMatchObject({
      agentId,
      userId,
      status: 'pending',
      source: 'mcp-events',
      type: 'issue.created',
      externalId: `${row.id}:event-1`,
      scopeKey: `inbound-webhook:${row.id}`,
      payload: event().data,
      metadata: { address: { webhookId: row.id }, entryPoint: 'inboundWebhook' },
    });
    expect(signal.occurredAt?.toISOString()).toBe(new Date(event().timestamp).toISOString());
    const updated = await model.findById(row.id);
    expect(updated?.state.cursor).toBe('cursor-1');
    expect(updated?.lastDeliveryAt).toBeInstanceOf(Date);
    await Promise.all(scheduled);
    expect(persistedWhenScheduled).toBe(1);
    expect(scheduleWake).toHaveBeenCalledTimes(1);
  });

  it('deduplicates webhook-id and eventId across delivery attempts', async () => {
    const row = await seed();
    expect((await deliver(row.id, event())).status).toBe(200);
    expect((await deliver(row.id, event({ data: { changed: true } }))).status).toBe(200);
    expect(scheduleWake).toHaveBeenCalledTimes(1);
    expect((await deliver(row.id, event(), { deliveryId: 'redelivery-new-id' })).status).toBe(200);
    const ledger = await db.select().from(signals);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].payload).toEqual(event().data);
  });

  it('does not resurrect processed signals or rewind the cursor on an old event redelivery', async () => {
    const row = await seed();
    expect((await deliver(row.id, event())).status).toBe(200);
    expect(
      (
        await deliver(row.id, event({ eventId: 'event-2', cursor: 'cursor-2' }), {
          deliveryId: 'delivery-2',
        })
      ).status,
    ).toBe(200);
    await db.update(signals).set({ status: 'processed', attempts: 1 });
    expect((await deliver(row.id, event(), { deliveryId: 'new-attempt' })).status).toBe(200);
    const ledger = await db.select().from(signals);
    expect(ledger).toHaveLength(2);
    expect(ledger.every((signal) => signal.status === 'processed' && signal.attempts === 1)).toBe(
      true,
    );
    expect((await model.findById(row.id))?.state.cursor).toBe('cursor-2');
    expect(scheduleWake).toHaveBeenCalledTimes(2);
  });

  it('keeps equal upstream event ids separate across subscriptions', async () => {
    const a = await seed();
    const b = await seed();
    expect((await deliver(a.id, event())).status).toBe(200);
    expect((await deliver(b.id, event())).status).toBe(200);
    expect(await db.select().from(signals)).toHaveLength(2);
  });

  it('records a gap durably, advancing cursor and marking possible truncation', async () => {
    const row = await seed();
    const payload = { type: 'gap', cursor: 'after-gap' };
    expect((await deliver(row.id, payload)).status).toBe(200);
    expect((await model.findById(row.id))?.state).toMatchObject({
      cursor: 'after-gap',
      truncated: true,
    });
    const [signal] = await db.select().from(signals);
    expect(signal).toMatchObject({
      payload,
      metadata: { extra: { control: 'gap' } },
      externalId: `${row.id}:delivery-1`,
    });
    expect(scheduleWake).toHaveBeenCalledTimes(1);
  });

  it('records terminated controls for asynchronous lifecycle handling', async () => {
    const row = await seed();
    const payload = { type: 'terminated', error: { code: -32001, message: 'Forbidden' } };
    expect((await deliver(row.id, payload)).status).toBe(200);
    expect((await deliver(row.id, payload)).status).toBe(200);
    const ledger = await db.select().from(signals);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ payload, metadata: { extra: { control: 'terminated' } } });
    expect(scheduleWake).toHaveBeenCalledTimes(1);
  });

  it('ignores unknown top-level control types, including bodies shaped like events', async () => {
    const row = await seed();
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await deliver(row.id, { type: 'future_control' })).status).toBe(200);
    expect(
      (await deliver(row.id, { ...event(), type: 'future_control' }, { deliveryId: 'future-2' }))
        .status,
    ).toBe(200);
    expect(await db.select().from(signals)).toEqual([]);
    expect(scheduleWake).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('permanently rejects an event with the wrong subscription name', async () => {
    const row = await seed();
    expect((await deliver(row.id, event({ name: 'another.event' }))).status).toBe(410);
    expect(await db.select().from(signals)).toEqual([]);
    expect(scheduleWake).not.toHaveBeenCalled();
  });

  it.each([
    'connection_refused',
    'timeout',
    'tls_error',
    'http_4xx',
    'http_5xx',
    'challenge_failed',
    'delivery_suspended',
  ] as const)('restores delivery error %s after a durable event', async (lastError) => {
    const row = await seed();
    await model.update(row.id, { status: 'error', lastError });
    expect((await deliver(row.id, event())).status).toBe(200);
    expect(await model.findById(row.id)).toMatchObject({ status: 'active', lastError: null });
  });

  it.each(['auth', 'wake_cap', 'insufficient_budget', 'server_unreachable', 'unknown'] as const)(
    'preserves non-delivery error %s after a durable event',
    async (lastError) => {
      const row = await seed();
      await model.update(row.id, { status: 'error', lastError });
      expect((await deliver(row.id, event())).status).toBe(200);
      expect(await model.findById(row.id)).toMatchObject({ status: 'error', lastError });
    },
  );

  it('does not clear an auth error that replaced a delivery error after the row was read', async () => {
    const row = await seed();
    await model.update(row.id, { status: 'error', lastError: 'http_5xx' });
    const originalDecrypt = gateKeeper.decrypt;
    vi.spyOn(gateKeeper, 'decrypt').mockImplementationOnce(async (ciphertext) => {
      await model.update(row.id, { status: 'error', lastError: 'auth' });
      return originalDecrypt(ciphertext);
    });
    expect((await deliver(row.id, event())).status).toBe(200);
    expect(await model.findById(row.id)).toMatchObject({ status: 'error', lastError: 'auth' });
  });

  it.each(['gap', 'verification'] as const)(
    'does not use %s controls as evidence of event delivery recovery',
    async (type) => {
      const row = await seed();
      await model.update(row.id, { status: 'error', lastError: 'delivery_suspended' });
      expect(
        (
          await deliver(
            row.id,
            type === 'gap' ? { type, cursor: 'gap' } : { type, challenge: 'challenge' },
          )
        ).status,
      ).toBe(200);
      expect(await model.findById(row.id)).toMatchObject({
        status: 'error',
        lastError: 'delivery_suspended',
      });
    },
  );

  it('rejects malformed signed JSON and event schemas', async () => {
    const row = await seed();
    expect((await deliver(row.id, {}, { rawBody: '{invalid' })).status).toBe(400);
    expect((await deliver(row.id, event({ timestamp: 'not-a-date' }))).status).toBe(400);
    expect((await deliver(row.id, event({ data: [] }))).status).toBe(400);
    expect(await db.select().from(signals)).toEqual([]);
    // The malformed envelope did not consume the delivery id permanently.
    expect((await deliver(row.id, event())).status).toBe(200);
  });

  it('releases the dedupe claim when persistence fails, enabling retry', async () => {
    const row = await seed();
    vi.spyOn(db, 'insert').mockImplementationOnce(() => {
      throw new Error('DB unavailable');
    });
    expect((await deliver(row.id, event())).status).toBe(503);
    expect((await deliver(row.id, event())).status).toBe(200);
    expect(await db.select().from(signals)).toHaveLength(1);
  });

  it('acknowledges durable signals despite queue failure and keeps them pending for the sweep', async () => {
    const row = await seed();
    scheduleWake.mockRejectedValueOnce(new Error('Queue unavailable'));
    expect((await deliver(row.id, event())).status).toBe(200);
    await Promise.all(scheduled);
    const ledger = await db.select().from(signals);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ status: 'pending', attempts: 0 });
    expect(claims.has(`${row.id}:delivery-1`)).toBe(true);
    expect((await deliver(row.id, event())).status).toBe(200);
    expect(await db.select().from(signals)).toHaveLength(1);
    expect(scheduleWake).toHaveBeenCalledTimes(1);
  });

  it.each(['new', 'pending duplicate'] as const)(
    'returns 200 for a %s signal while queue publication remains blocked',
    async (scenario) => {
      const row = await seed();
      if (scenario === 'pending duplicate') {
        expect((await deliver(row.id, event())).status).toBe(200);
        await Promise.all(scheduled);
        scheduleWake.mockClear();
      }
      const started = Promise.withResolvers<void>();
      const blocked = Promise.withResolvers<void>();
      scheduleWake.mockImplementation(() => {
        started.resolve();
        return blocked.promise;
      });
      const request = deliver(row.id, event(), { deliveryId: 'blocked-publish' });
      let marker: ReturnType<typeof setImmediate> | undefined;
      try {
        await started.promise;
        // An event-loop turn proves HTTP can finish while the publisher promise is still pending.
        const response = await Promise.race([
          request,
          new Promise<null>((resolve) => {
            marker = setImmediate(() => resolve(null));
          }),
        ]);
        expect(response?.status).toBe(200);
        const ledger = await db.select().from(signals);
        expect(ledger).toHaveLength(1);
        expect(ledger[0]).toMatchObject({ status: 'pending', externalId: `${row.id}:event-1` });
        expect(scheduleWake).toHaveBeenCalledTimes(1);
      } finally {
        if (marker) clearImmediate(marker);
        blocked.resolve();
        await request;
        await Promise.all(scheduled);
      }
    },
  );
});
