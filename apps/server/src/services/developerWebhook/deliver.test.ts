// @vitest-environment node
import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { getTestDB } from '@lobechat/database/test-utils';
import type * as TypesModule from '@lobechat/types';
import { WEBHOOK_DELIVERY_POLICY, webhookRetryDelaySeconds } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { WebhookEndpointModel } from '@/database/models/developerWebhook';
import { users, webhookDeliveries, webhookEndpoints } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { attemptWebhookDelivery } from './deliver';

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: async () => ({
      // `bad:` ciphertexts fail like a rotated KEY_VAULTS_SECRET does: empty and not authentic.
      decrypt: async (value: string) =>
        value.startsWith('bad:')
          ? { plaintext: '', wasAuthentic: false }
          : { plaintext: value.slice('cipher:'.length), wasAuthentic: true },
      encrypt: async (value: string) => `cipher:${value}`,
    }),
  },
}));

// Keep the real policy but make the timeout test fast.
vi.mock('@lobechat/types', async (importOriginal) => {
  const actual = await importOriginal<typeof TypesModule>();
  return {
    ...actual,
    WEBHOOK_DELIVERY_POLICY: { ...actual.WEBHOOK_DELIVERY_POLICY, timeoutMs: 300 },
  };
});

const SECRET = 'whsec_test_secret';
const userId = 'webhook-deliver-user';

interface Received {
  body: string;
  headers: IncomingMessage['headers'];
}

let server: Server;
let baseUrl: string;
let received: Received[] = [];
let respond: (path: string) => { delayMs?: number; status: number } = () => ({ status: 200 });
/** Runs after the request arrives and before its response, to model a concurrent writer. */
let beforeRespond: (path: string) => Promise<void> = async () => {};

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      received.push({ body, headers: req.headers });
      const { delayMs = 0, status } = respond(req.url ?? '/');
      await beforeRespond(req.url ?? '/');
      setTimeout(() => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: status < 300 }));
      }, delayMs);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

let db: LobeChatDatabase;
let model: WebhookEndpointModel;

const createEndpoint = (path = '/hook', overrides: Partial<{ consecutiveFailures: number }> = {}) =>
  model
    .create({
      events: ['task.status_changed'],
      secret: `cipher:${SECRET}`,
      secretHint: 'cret',
      url: `${baseUrl}${path}`,
    })
    .then(async (endpoint) => {
      if (overrides.consecutiveFailures !== undefined)
        await db
          .update(webhookEndpoints)
          .set({ consecutiveFailures: overrides.consecutiveFailures })
          .where(eq(webhookEndpoints.id, endpoint.id));
      return endpoint;
    });

const queueEvent = (
  endpointId: string,
  type: 'task.status_changed' | 'webhook.test' = 'task.status_changed',
) =>
  model.createDelivery({ id: endpointId }, {
    createdAt: '2026-11-18T00:00:00.000Z',
    data:
      type === 'webhook.test'
        ? { message: 'hi', webhookId: endpointId }
        : { identifier: 'T-1', previousStatus: 'todo', status: 'running', taskId: 'task_1' },
    id: 'evt_test_1',
    type,
    workspaceId: null,
  } as never);

const loadDelivery = async (id: string) =>
  (await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id)))[0];
/** Fast-forward a scheduled retry to now, as if its delay had passed. */
const makeDue = (id: string) =>
  db
    .update(webhookDeliveries)
    .set({ nextAttemptAt: new Date() })
    .where(eq(webhookDeliveries.id, id));
const loadEndpoint = async (id: string) =>
  (await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, id)))[0];

beforeEach(async () => {
  db = await getTestDB();
  await db.delete(users).where(eq(users.id, userId));
  await db.insert(users).values({ id: userId });
  model = new WebhookEndpointModel(db, userId);
  received = [];
  respond = () => ({ status: 200 });
  beforeRespond = async () => {};
  // The receiver listens on loopback; allow it for every test except the SSRF one.
  process.env.SSRF_ALLOW_PRIVATE_IP_ADDRESS = '1';
});

afterEach(async () => {
  delete process.env.SSRF_ALLOW_PRIVATE_IP_ADDRESS;
  await db.delete(users).where(eq(users.id, userId));
});

describe('attemptWebhookDelivery', () => {
  it('POSTs the envelope with an HMAC-SHA256 signature over "<timestamp>.<body>"', async () => {
    const endpoint = await createEndpoint();
    const delivery = await queueEvent(endpoint.id);

    const result = await attemptWebhookDelivery(db, delivery.id);

    expect(result.outcome).toBe('succeeded');
    expect(received).toHaveLength(1);
    const [{ body, headers }] = received;
    const timestamp = headers['x-lobehub-timestamp'] as string;
    const expected = `v1=${createHmac('sha256', SECRET).update(`${timestamp}.${body}`).digest('hex')}`;
    expect(headers['x-lobehub-signature']).toBe(expected);
    expect(headers['x-lobehub-event-id']).toBe('evt_test_1');
    expect(headers['x-lobehub-event-type']).toBe('task.status_changed');
    expect(headers['x-lobehub-delivery-id']).toBe(delivery.id);
    // The header carries the same integer-seconds timestamp the signature is computed over;
    // a wall-clock bound here would only measure how busy the CI machine is.
    expect(timestamp).toMatch(/^\d{10}$/);
    expect(JSON.parse(body)).toEqual({
      createdAt: '2026-11-18T00:00:00.000Z',
      data: { identifier: 'T-1', previousStatus: 'todo', status: 'running', taskId: 'task_1' },
      id: 'evt_test_1',
      type: 'task.status_changed',
      workspaceId: null,
    });

    const row = await loadDelivery(delivery.id);
    expect(row).toMatchObject({ attempts: 1, responseStatus: 200, status: 'succeeded' });
    expect(row.durationMs).toBeGreaterThanOrEqual(0);
    expect(row.deliveredAt).toBeInstanceOf(Date);
  });

  it('retries a failed attempt with exponential backoff until maxAttempts, then fails', async () => {
    respond = () => ({ status: 500 });
    const endpoint = await createEndpoint('/fail');
    const delivery = await queueEvent(endpoint.id);

    const delays: number[] = [];
    for (let attempt = 1; attempt < WEBHOOK_DELIVERY_POLICY.maxAttempts; attempt++) {
      const result = await attemptWebhookDelivery(db, delivery.id);
      expect(result.outcome).toBe('retry');
      if (result.outcome === 'retry') delays.push(result.delaySeconds);
      const row = await loadDelivery(delivery.id);
      expect(row).toMatchObject({ attempts: attempt, responseStatus: 500, status: 'retrying' });
      expect(row.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
      await makeDue(delivery.id);
    }
    // 30s, 2m, 8m, 32m, ~2h
    expect(delays).toEqual([30, 120, 480, 1920, 7680]);
    expect(delays).toEqual([1, 2, 3, 4, 5].map((n) => webhookRetryDelaySeconds(n)));

    const last = await attemptWebhookDelivery(db, delivery.id);
    expect(last.outcome).toBe('failed');
    expect(received).toHaveLength(WEBHOOK_DELIVERY_POLICY.maxAttempts);
    expect(await loadDelivery(delivery.id)).toMatchObject({
      attempts: WEBHOOK_DELIVERY_POLICY.maxAttempts,
      error: 'HTTP 500',
      nextAttemptAt: null,
      status: 'failed',
    });
    expect((await loadEndpoint(endpoint.id)).consecutiveFailures).toBe(1);

    // A settled delivery is never sent again (QStash may repeat a callback).
    expect(await attemptWebhookDelivery(db, delivery.id)).toEqual({
      outcome: 'skipped',
      reason: 'already_settled',
    });
  });

  it('records a timed-out attempt as failed with a timeout error and schedules a retry', async () => {
    respond = () => ({ delayMs: 1000, status: 200 });
    const endpoint = await createEndpoint('/slow');
    const delivery = await queueEvent(endpoint.id);

    const result = await attemptWebhookDelivery(db, delivery.id);

    expect(result.outcome).toBe('retry');
    const row = await loadDelivery(delivery.id);
    expect(row.status).toBe('retrying');
    expect(row.responseStatus).toBeNull();
    expect(row.error).toBe('Timed out after 300 ms');
  });

  it('disables the endpoint once five deliveries in a row exhaust their retries', async () => {
    respond = () => ({ status: 503 });
    const endpoint = await createEndpoint('/down', {
      consecutiveFailures: WEBHOOK_DELIVERY_POLICY.disableAfterConsecutiveFailures - 1,
    });
    const delivery = await queueEvent(endpoint.id);
    await db
      .update(webhookDeliveries)
      .set({ attempts: WEBHOOK_DELIVERY_POLICY.maxAttempts - 1 })
      .where(eq(webhookDeliveries.id, delivery.id));

    const result = await attemptWebhookDelivery(db, delivery.id);

    expect(result).toMatchObject({ endpointDisabled: true, outcome: 'failed' });
    expect(await loadEndpoint(endpoint.id)).toMatchObject({
      consecutiveFailures: WEBHOOK_DELIVERY_POLICY.disableAfterConsecutiveFailures,
      disabledReason: 'consecutive_failures',
      enabled: false,
    });

    // Later deliveries to the disabled endpoint are not sent.
    const next = await queueEvent(endpoint.id);
    const before = received.length;
    expect(await attemptWebhookDelivery(db, next.id)).toEqual({
      outcome: 'skipped',
      reason: 'endpoint_disabled',
    });
    expect(received.length).toBe(before);
    expect(await loadDelivery(next.id)).toMatchObject({
      error: 'Endpoint is disabled',
      status: 'failed',
    });
  });

  it('a success resets the failure streak', async () => {
    const endpoint = await createEndpoint('/ok', { consecutiveFailures: 3 });
    const delivery = await queueEvent(endpoint.id);
    await attemptWebhookDelivery(db, delivery.id);
    expect((await loadEndpoint(endpoint.id)).consecutiveFailures).toBe(0);
  });

  it('refuses a private address through ssrf-safe-fetch and does not retry it', async () => {
    delete process.env.SSRF_ALLOW_PRIVATE_IP_ADDRESS;
    const endpoint = await createEndpoint('/internal');
    const delivery = await queueEvent(endpoint.id);

    const result = await attemptWebhookDelivery(db, delivery.id);

    expect(result.outcome).toBe('failed');
    expect(received).toHaveLength(0);
    expect(await loadDelivery(delivery.id)).toMatchObject({
      attempts: 1,
      error: 'Blocked: the URL resolves to a private or reserved address',
      responseStatus: null,
      status: 'failed',
    });
  });

  it('sends an attempt once even when two queue messages race for it', async () => {
    respond = () => ({ delayMs: 50, status: 200 });
    const endpoint = await createEndpoint('/race');
    const delivery = await queueEvent(endpoint.id);

    const results = await Promise.all([
      attemptWebhookDelivery(db, delivery.id),
      attemptWebhookDelivery(db, delivery.id),
    ]);

    expect(results.map((r) => r.outcome).sort()).toEqual(['skipped', 'succeeded']);
    expect(results).toContainEqual({ outcome: 'skipped', reason: 'already_claimed' });
    expect(received).toHaveLength(1);
    expect(await loadDelivery(delivery.id)).toMatchObject({ attempts: 1, status: 'succeeded' });
  });

  it('keeps a delivery canceled by a redirect when the in-flight attempt fails', async () => {
    respond = () => ({ delayMs: 20, status: 500 });
    const endpoint = await createEndpoint('/redirected');
    const delivery = await queueEvent(endpoint.id);
    // The endpoint's update cancels its pending deliveries while this POST is in flight;
    // it does not touch the attempt counter the settlement CAS matches on.
    beforeRespond = async () => {
      await db
        .update(webhookDeliveries)
        .set({
          error: 'Endpoint destination changed',
          nextAttemptAt: null,
          status: 'failed',
          updatedAt: new Date(),
        })
        .where(eq(webhookDeliveries.id, delivery.id));
    };

    const result = await attemptWebhookDelivery(db, delivery.id);

    // Without the terminal-status guard the counter-only CAS would restore `retrying` and
    // the retry would post this payload to the new destination.
    expect(result).toEqual({ outcome: 'skipped', reason: 'already_settled' });
    expect(await loadDelivery(delivery.id)).toMatchObject({
      attempts: 1,
      error: 'Endpoint destination changed',
      nextAttemptAt: null,
      status: 'failed',
    });
    expect((await loadEndpoint(endpoint.id)).consecutiveFailures).toBe(0);
  });

  it('ignores a late duplicate that arrives before the retry is due', async () => {
    respond = () => ({ status: 500 });
    const endpoint = await createEndpoint('/early');
    const delivery = await queueEvent(endpoint.id);
    expect((await attemptWebhookDelivery(db, delivery.id)).outcome).toBe('retry');

    // The first attempt's queue message, delivered again: the retry is 30 s away.
    expect(await attemptWebhookDelivery(db, delivery.id)).toEqual({
      outcome: 'skipped',
      reason: 'not_due',
    });
    expect(received).toHaveLength(1);
    expect(await loadDelivery(delivery.id)).toMatchObject({ attempts: 1, status: 'retrying' });
  });

  it('never signs with a secret it cannot decrypt', async () => {
    const endpoint = await createEndpoint('/secret');
    await db
      .update(webhookEndpoints)
      .set({ secret: 'bad:ciphertext' })
      .where(eq(webhookEndpoints.id, endpoint.id));
    const delivery = await queueEvent(endpoint.id);

    const result = await attemptWebhookDelivery(db, delivery.id);

    expect(result.outcome).toBe('failed');
    expect(received).toHaveLength(0);
    expect(await loadDelivery(delivery.id)).toMatchObject({
      attempts: 1,
      error: 'The signing secret cannot be decrypted; rotate the secret',
      status: 'failed',
    });
  });

  it('a test delivery makes one attempt and leaves the failure count alone', async () => {
    respond = () => ({ status: 500 });
    const endpoint = await createEndpoint('/test', { consecutiveFailures: 2 });
    const delivery = await queueEvent(endpoint.id, 'webhook.test');

    const result = await attemptWebhookDelivery(db, delivery.id);

    expect(result.outcome).toBe('failed');
    expect(received).toHaveLength(1);
    expect((await loadEndpoint(endpoint.id)).consecutiveFailures).toBe(2);
  });
});
