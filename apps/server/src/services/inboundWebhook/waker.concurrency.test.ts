// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import type { ExecAgentResult } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InboundWebhookModel } from '@/database/models/inboundWebhook';
import {
  agents,
  signalDecisions,
  signals,
  topics,
  userConnectors,
  users,
} from '@/database/schemas';
import {
  inboundWebhook,
  inboundWebhookBodyLimit,
} from '@/server/router-hono/webhooks/handlers/inbound';

import { receiverTestSecret, signedWebhookHeaders } from './receiverTestUtils';
import { wakeInboundWebhook } from './waker';

const boundary = vi.hoisted(() => ({
  enabled: vi.fn(),
  listEvents: vi.fn(),
  subscribe: vi.fn(),
  gate: {
    encrypt: async (s: string) => `cipher:${s}`,
    decrypt: async (s: string) => ({ plaintext: s.slice(7) }),
  },
}));
vi.mock('@/server/services/mcp/featureGate', () => ({ isMcpEventsEnabled: boundary.enabled }));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: async () => db }));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => boundary.gate },
}));
vi.mock('@/server/services/redis', () => ({
  redisService: {
    inboundWebhook: {
      claimDelivery: async () => true,
      releaseDelivery: async () => {},
      claimWakeWindow: async () => false,
    },
  },
}));
vi.mock('@/server/utils/scheduleAfterResponse', () => ({ afterUnscoped: () => {} }));
vi.mock('@/server/services/inboundWebhook/sweep', () => ({
  scheduleInboundWebhookSweep: () => {},
}));
vi.mock('@/server/services/mcp', () => ({
  mcpService: { listEvents: boundary.listEvents, subscribeEvent: boundary.subscribe },
}));
vi.mock('@/server/services/connector/tokens', () => ({
  ensureFreshConnectorToken: async (c: unknown) => c,
}));
const db = await getTestDB();
const userId = 'wake-concurrency-user';
const agentId = 'wake-concurrency-agent';
const topicId = 'wake-concurrency-topic';
const connectorId = 'c3869dc5-18f3-4360-8146-d103a67ede79';
const model = new InboundWebhookModel(db, userId, undefined, boundary.gate);
const app = new Hono().post('/inbound/:id', inboundWebhookBodyLimit, inboundWebhook);
const success = { success: true, operationId: 'concurrency-op' } as ExecAgentResult;
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
let id: string;
beforeEach(async () => {
  vi.clearAllMocks();
  boundary.enabled.mockResolvedValue(true);
  await db.insert(users).values({ id: userId });
  await db.insert(agents).values({ id: agentId, userId });
  await db.insert(topics).values({ id: topicId, agentId, userId });
  await db.insert(userConnectors).values({
    id: connectorId,
    userId,
    identifier: 'linear',
    name: 'Linear',
    sourceType: 'custom',
    mcpConnectionType: 'http',
    mcpServerUrl: 'https://mcp.example.com',
    isEnabled: true,
    status: 'connected',
  });
  id = (
    await model.create({
      agentId,
      topicId,
      connectorId,
      config: { eventName: 'issue.created', arguments: {} },
      kind: 'mcp_events',
      status: 'active',
      secret: receiverTestSecret,
      verification: { scheme: 'standard_webhooks' },
    })
  ).id;
  boundary.listEvents.mockResolvedValue([{ name: 'issue.created', delivery: ['webhook'] }]);
  boundary.subscribe.mockResolvedValue({ id: 'remote', refreshBefore: null });
});
afterEach(async () => {
  await db.delete(users).where(eq(users.id, userId));
  vi.restoreAllMocks();
});

const delivery = (eventId = 'new-event') => {
  const body = JSON.stringify({
    eventId,
    name: 'issue.created',
    data: { issue: 2 },
    timestamp: new Date().toISOString(),
    cursor: 'new-cursor',
  });
  const headers = signedWebhookHeaders(body);
  headers.set('x-mcp-subscription-id', 'remote');
  return app.request(`/inbound/${id}`, { method: 'POST', body, headers });
};
const seed = async (terminated: boolean) => {
  await db.insert(signals).values({
    userId,
    agentId,
    source: 'mcp-events',
    type: 'issue.created',
    externalId: `${id}:old-event`,
    scopeKey: `inbound-webhook:${id}`,
    payload: terminated ? { error: { code: -32023, message: 'NotFound' } } : { issue: 1 },
    metadata: terminated ? { extra: { control: 'terminated' } } : {},
  });
};

describe('wake and ingress concurrency', () => {
  it('persists and acknowledges disabled-owner events, skips the batch with decisions, then wakes after re-enabling', async () => {
    boundary.enabled.mockResolvedValue(false);
    const execute = vi.fn(async () => success);
    const deps = { execute, intervention: async () => ({ approvalMode: 'manual' as const }) };
    expect((await delivery('disabled-1')).status).toBe(200);
    expect((await delivery('disabled-1')).status).toBe(200);
    expect((await delivery('disabled-2')).status).toBe(200);
    expect(await db.select().from(signals)).toHaveLength(2);
    expect(await wakeInboundWebhook(db, id, deps)).toEqual({ outcome: 'ignored' });
    expect(execute).not.toHaveBeenCalled();
    expect(boundary.enabled).toHaveBeenCalledExactlyOnceWith(userId);
    expect(
      (await db.select().from(signals)).every(
        (row) => row.status === 'ignored' && row.error === 'feature_disabled',
      ),
    ).toBe(true);
    const decisions = await db.select().from(signalDecisions);
    expect(decisions).toHaveLength(2);
    expect(
      decisions.every((row) => row.outcome === 'skip' && row.finalReason === 'feature_disabled'),
    ).toBe(true);
    expect(await model.findById(id)).toMatchObject({
      wakeCount: 0,
      status: 'active',
      lastError: null,
    });

    boundary.enabled.mockResolvedValue(true);
    expect((await delivery('enabled-3')).status).toBe(200);
    expect(await wakeInboundWebhook(db, id, deps)).toEqual({ outcome: 'processed' });
    expect(execute).toHaveBeenCalledOnce();
    expect(
      (await db.select().from(signals)).filter((row) => row.status === 'processed'),
    ).toHaveLength(1);
    expect(
      (await db.select().from(signals)).filter((row) => row.status === 'ignored'),
    ).toHaveLength(2);
    expect(await model.findById(id)).toMatchObject({ wakeCount: 1, status: 'active' });
  });

  it.each(['agent start', 'event rediscovery', 'remote resubscribe'] as const)(
    'acknowledges a new event while %s is suspended',
    async (phase) => {
      const started = deferred();
      const finish = deferred();
      const pause = async () => {
        started.resolve();
        await finish.promise;
      };
      const execute = vi.fn(async () => {
        if (phase === 'agent start') await pause();
        return success;
      });
      if (phase === 'event rediscovery')
        boundary.listEvents.mockImplementation(async () => {
          await pause();
          return [];
        });
      if (phase === 'remote resubscribe')
        boundary.subscribe.mockImplementation(async () => {
          await pause();
          return { id: 'remote', refreshBefore: null };
        });
      await seed(phase !== 'agent start');
      const running = wakeInboundWebhook(db, id, {
        execute,
        intervention: async () => ({ approvalMode: 'manual' }),
      });
      await started.promise;
      const request = delivery();
      let response: Response | undefined;
      let stored = false;
      try {
        response = await Promise.race([
          request,
          new Promise<undefined>((done) => setTimeout(done, 200)),
        ]);
        if (response)
          stored = !!(
            await db
              .select()
              .from(signals)
              .where(eq(signals.externalId, `${id}:new-event`))
          )[0];
      } finally {
        finish.resolve();
        await running;
        await request;
      }
      expect(response?.status, 'ingress must finish before the network call is released').toBe(200);
      expect(stored).toBe(true);
    },
  );

  it('renews its claim while startup is still waiting, keeping a later worker out', async () => {
    await seed(false);
    const started = deferred();
    const finish = deferred();
    const interval = vi.spyOn(globalThis, 'setInterval');
    const execute = vi.fn(async () => {
      started.resolve();
      await finish.promise;
      return success;
    });
    const deps = { execute, intervention: async () => ({ approvalMode: 'manual' as const }) };
    const first = wakeInboundWebhook(db, id, deps);
    await started.promise;
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 4 * 60_000);
    try {
      const heartbeat = interval.mock.calls.find((call) => call[1] === 30_000)?.[0] as () => void;
      expect(heartbeat).toBeTypeOf('function');
      heartbeat();
      await vi.waitFor(async () => {
        const [stored] = await db
          .select()
          .from(signals)
          .where(eq(signals.externalId, `${id}:old-event`));
        expect(stored.metadata.extra?.inboundWebhookWake).toMatchObject({
          leaseUntil: now + 9 * 60_000,
        });
      });
      clock.mockReturnValue(now + 6 * 60_000);
      expect(await wakeInboundWebhook(db, id, deps)).toEqual({ outcome: 'empty' });
    } finally {
      finish.resolve();
      await first;
    }
    expect(execute).toHaveBeenCalledOnce();
  });

  it('does not start the same claimed events on a second worker', async () => {
    await seed(false);
    const started = deferred();
    const finish = deferred();
    const execute = vi.fn(async () => {
      started.resolve();
      await finish.promise;
      return success;
    });
    const deps = { execute, intervention: async () => ({ approvalMode: 'manual' as const }) };
    const first = wakeInboundWebhook(db, id, deps);
    await started.promise;
    const second = wakeInboundWebhook(db, id, deps);
    let outcome: { outcome: string } | undefined;
    try {
      outcome = await Promise.race([
        second,
        new Promise<undefined>((done) => setTimeout(done, 200)),
      ]);
    } finally {
      finish.resolve();
      await first;
      await second;
    }
    expect(outcome).toEqual({ outcome: 'empty' });
    expect(execute).toHaveBeenCalledOnce();
  });
});
