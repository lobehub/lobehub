// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, inboundWebhooks, topics, users, workspaces } from '../../schemas';
import type { CreateInboundWebhook, InboundWebhookPatch } from '../inboundWebhook';
import { InboundWebhookLimitError, InboundWebhookModel } from '../inboundWebhook';

const db = await getTestDB();
const userId = 'inbound-user';
const otherUserId = 'inbound-other';
const agentId = 'inbound-agent';
const topicId = 'inbound-topic';
const missing = '00000000-0000-0000-0000-000000000000';
const gateKeeper = {
  encrypt: async (value: string) => `cipher:${Buffer.from(value).toString('base64')}`,
  decrypt: async (value: string) => ({
    plaintext: Buffer.from(value.slice(7), 'base64').toString(),
  }),
};
const model = new InboundWebhookModel(db, userId, undefined, gateKeeper);
const otherModel = new InboundWebhookModel(db, otherUserId, undefined, gateKeeper);
const input = (patch: Partial<CreateInboundWebhook> = {}): CreateInboundWebhook => ({
  agentId,
  topicId,
  kind: 'mcp_events',
  config: { arguments: { project: 'test' }, eventName: 'issue.created' },
  verification: { scheme: 'standard_webhooks' },
  secret: 'whsec_test',
  ...patch,
});

beforeEach(async () => {
  await db.delete(users);
  await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await db.insert(agents).values({ id: agentId, userId });
  await db.insert(topics).values({ id: topicId, userId, agentId });
});

afterEach(async () => {
  await db.delete(users);
});

describe('InboundWebhookModel secret handling and validation', () => {
  it('encrypts on insert, never returns ciphertext, and explicitly decrypts for delivery', async () => {
    const created = await model.create(input());
    expect(created).not.toHaveProperty('secret');
    const [raw] = await db.select().from(inboundWebhooks).where(eq(inboundWebhooks.id, created.id));
    expect(raw.secret).not.toBe('whsec_test');
    expect(raw.secret).toMatch(/^cipher:/);
    expect(await model.getSecret(created.id)).toBe('whsec_test');
    const delivery = await InboundWebhookModel.findForDelivery(db, created.id, gateKeeper);
    expect(delivery?.secret).toBe('whsec_test');
    expect(delivery?.row).not.toHaveProperty('secret');
    expect(await model.findById(created.id)).not.toHaveProperty('secret');
    expect((await model.query({ includeHidden: true }))[0]).not.toHaveProperty('secret');
  });

  it('requires encryption instead of writing plaintext when the gatekeeper is absent', async () => {
    const unencrypted = new InboundWebhookModel(db, userId);
    await expect(unencrypted.create(input())).rejects.toThrow(/needs a gatekeeper/);
    expect(await model.query({ includeHidden: true })).toEqual([]);
    const row = await model.create(input());
    await expect(unencrypted.getSecret(row.id)).rejects.toThrow(/needs a gatekeeper/);
    await expect(InboundWebhookModel.findForDelivery(db, row.id)).rejects.toThrow(
      /needs a gatekeeper/,
    );
  });

  it('initializes delivery credentials lazily only for a known live row with a secret', async () => {
    const lazyGateKeeper = vi.fn(async () => gateKeeper);
    expect(await InboundWebhookModel.findForDelivery(db, missing, lazyGateKeeper)).toBeUndefined();
    const deleting = await model.create(input({ status: 'deleting' }));
    expect(
      await InboundWebhookModel.findForDelivery(db, deleting.id, lazyGateKeeper),
    ).toBeUndefined();
    const retired = await model.create(input());
    await db
      .update(inboundWebhooks)
      .set({ kind: 'retired' as never })
      .where(eq(inboundWebhooks.id, retired.id));
    expect(
      await InboundWebhookModel.findForDelivery(db, retired.id, lazyGateKeeper),
    ).toBeUndefined();
    const unsigned = await model.create(input({ secret: null }));
    expect(
      (await InboundWebhookModel.findForDelivery(db, unsigned.id, lazyGateKeeper))?.secret,
    ).toBeNull();
    expect(lazyGateKeeper).not.toHaveBeenCalled();
    const active = await model.create(input({ status: 'active' }));
    expect((await InboundWebhookModel.findForDelivery(db, active.id, lazyGateKeeper))?.secret).toBe(
      'whsec_test',
    );
    expect(lazyGateKeeper).toHaveBeenCalledTimes(1);
  });

  it('supports endpoints without a signing secret and returns null for absent rows', async () => {
    const row = await model.create(input({ secret: null }));
    expect(await model.getSecret(row.id)).toBeNull();
    expect(await model.getSecret(missing)).toBeNull();
    expect(await InboundWebhookModel.findForDelivery(db, row.id)).toEqual({ row, secret: null });
    expect(await InboundWebhookModel.findForDelivery(db, missing)).toBeUndefined();
  });

  it.each([
    { config: { arguments: {}, eventName: '' } },
    { config: { eventName: 'event', arguments: [] } },
    { state: { refreshBefore: 'tomorrow' } },
    { state: { cursor: 42 } },
    { verification: { scheme: 'none' } },
    { kind: 'unknown' },
  ])('rejects invalid kind data before inserting: %j', async (patch) => {
    await expect(
      model.create(input(patch as unknown as Partial<CreateInboundWebhook>)),
    ).rejects.toThrow();
    expect(await model.query({ includeHidden: true })).toEqual([]);
  });

  it('rejects invalid state patches and immutable configuration updates before writing', async () => {
    const row = await model.create(input());
    await expect(model.mergeState(row.id, { cursor: 7 } as never)).rejects.toThrow();
    await expect(
      model.update(row.id, { config: { eventName: 'changed' } } as InboundWebhookPatch),
    ).rejects.toThrow();
    expect((await model.findById(row.id))?.config.eventName).toBe('issue.created');
    expect((await model.findById(row.id))?.state).toEqual({});
  });

  it('strips new remote delivery-health fields while validating known state fields', async () => {
    const row = await model.create(
      input({ state: { deliveryStatus: { active: true, serverHint: 'future' } } as never }),
    );
    expect(row.state.deliveryStatus).toEqual({ active: true });
    await model.mergeState(row.id, { deliveryStatus: { active: false, newField: 1 } } as never);
    expect((await model.findById(row.id))?.state.deliveryStatus).toEqual({ active: false });
    await expect(
      model.mergeState(row.id, { deliveryStatus: { active: 'wrong' } } as never),
    ).rejects.toThrow();
    await expect(model.mergeState(row.id, { futureTopLevel: true } as never)).rejects.toThrow();
  });

  it('stops delivery for deleting, unknown and invalid stored kinds', async () => {
    const row = await model.create(input({ status: 'deleting' }));
    expect(await InboundWebhookModel.findForDelivery(db, row.id, gateKeeper)).toBeUndefined();
    await db
      .update(inboundWebhooks)
      .set({ status: 'active', kind: 'retired' as never })
      .where(eq(inboundWebhooks.id, row.id));
    expect(await InboundWebhookModel.findForDelivery(db, row.id, gateKeeper)).toBeUndefined();
  });
});

describe('InboundWebhookModel scope and lifecycle', () => {
  it('isolates every user operation', async () => {
    const row = await model.create(input({ status: 'active' }));
    expect(await otherModel.query()).toEqual([]);
    expect(await otherModel.findById(row.id)).toBeUndefined();
    expect(await otherModel.getSecret(row.id)).toBeNull();
    expect(await otherModel.mergeState(row.id, { cursor: 'stolen' })).toBeUndefined();
    expect(await otherModel.update(row.id, { status: 'error' })).toBeUndefined();
    expect(await otherModel.reserveWake(row.id)).toBe(false);
    await otherModel.delete(row.id);
    expect((await model.findById(row.id))?.status).toBe('active');
    await model.delete(row.id);
    expect(await model.findById(row.id)).toBeUndefined();
  });

  it('shares workspace rows while excluding personal and other workspace rows', async () => {
    await db.insert(workspaces).values([
      { id: 'inbound-workspace', slug: 'inbound-workspace', name: 'Team', primaryOwnerId: userId },
      { id: 'other-workspace', slug: 'other-workspace', name: 'Other', primaryOwnerId: userId },
    ]);
    const owner = new InboundWebhookModel(db, userId, 'inbound-workspace', gateKeeper);
    const member = new InboundWebhookModel(db, otherUserId, 'inbound-workspace', gateKeeper);
    const otherWorkspace = new InboundWebhookModel(db, userId, 'other-workspace', gateKeeper);
    const row = await owner.create(input({ status: 'active' }));
    await model.create(input({ status: 'active' }));
    await otherWorkspace.create(input({ status: 'active' }));
    expect((await member.query()).map((r) => r.id)).toEqual([row.id]);
    expect(await member.findById(row.id)).toEqual(row);
    expect(await model.query()).toHaveLength(1);
    expect(await otherWorkspace.findById(row.id)).toBeUndefined();
    await db.delete(workspaces);
  });

  it('filters hidden lifecycle rows and returns newest first with domain filters', async () => {
    const active = await model.create(
      input({ status: 'active', createdAt: new Date('2026-01-01') }),
    );
    const terminated = await model.create(
      input({ status: 'terminated', createdAt: new Date('2026-01-02') }),
    );
    await model.create(input());
    await model.create(input({ status: 'deleting' }));
    expect((await model.query({ topicId, agentId })).map((r) => r.id)).toEqual([
      terminated.id,
      active.id,
    ]);
    expect(await model.query({ topicId: 'missing-topic' })).toEqual([]);
    expect(await model.query({ agentId: 'missing-agent' })).toEqual([]);
    expect(await model.query({ connectorId: missing })).toEqual([]);
    expect(await model.query({ includeHidden: true })).toHaveLength(4);
  });

  it('does not reactivate a deleting row when an in-flight maintenance call finishes', async () => {
    const row = await model.create(input({ status: 'active' }));
    const retryAt = new Date(Date.now() + 60_000);
    await model.update(row.id, {
      status: 'deleting',
      nextMaintenanceAt: retryAt,
      maintenanceFailures: 2,
    });
    expect(
      await model.update(row.id, {
        status: 'active',
        nextMaintenanceAt: null,
        maintenanceFailures: 0,
      }),
    ).toBeUndefined();
    expect(
      await model.update(row.id, { status: 'error', lastError: 'auth', nextMaintenanceAt: null }),
    ).toBeUndefined();
    expect(await model.findById(row.id)).toMatchObject({
      status: 'deleting',
      nextMaintenanceAt: retryAt,
      maintenanceFailures: 2,
      lastError: null,
    });
    const laterRetry = new Date(Date.now() + 120_000);
    expect(
      await model.update(row.id, {
        status: 'deleting',
        nextMaintenanceAt: laterRetry,
        maintenanceFailures: 3,
      }),
    ).toMatchObject({ status: 'deleting', nextMaintenanceAt: laterRetry, maintenanceFailures: 3 });
  });

  it('enforces deduplication per creator and kind, permitting absent keys', async () => {
    await model.create(input({ dedupeKey: 'same-subscription' }));
    await expect(model.create(input({ dedupeKey: 'same-subscription' }))).rejects.toThrow();
    await otherModel.create(input({ dedupeKey: 'same-subscription' }));
    await model.create(input());
    await model.create(input());
    expect(await model.query({ includeHidden: true })).toHaveLength(3);
  });

  it('merges concurrent cursor and lease updates without losing unrelated state', async () => {
    const row = await model.create(input());
    await Promise.all([
      model.mergeState(row.id, { cursor: 'cursor-2' }),
      model.mergeState(row.id, { refreshBefore: '2027-01-01T00:00:00Z' }),
      model.mergeState(row.id, { truncated: true }),
    ]);
    expect((await model.findById(row.id))?.state).toEqual({
      cursor: 'cursor-2',
      refreshBefore: '2027-01-01T00:00:00Z',
      truncated: true,
    });
  });

  it('allows only one cursor CAS from concurrently observed state', async () => {
    const row = await model.create(input({ state: { cursor: 'initial' } }));
    const results = await Promise.all([
      model.mergeStateIf(row.id, { cursor: 'next-1' }, { cursor: 'initial' }),
      model.mergeStateIf(row.id, { cursor: 'next-2' }, { cursor: 'initial' }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(['next-1', 'next-2']).toContain((await model.findById(row.id))?.state.cursor);
    expect(await otherModel.mergeStateIf(row.id, { truncated: true }, {})).toBeUndefined();
    expect((await model.findById(row.id))?.state.truncated).toBeUndefined();
  });

  it('distinguishes an absent JSON key from an explicit null in cursor CAS', async () => {
    const row = await model.create(input());
    expect(await model.mergeStateIf(row.id, { cursor: null }, { cursor: undefined })).toBeDefined();
    expect(
      await model.mergeStateIf(row.id, { cursor: 'stale' }, { cursor: undefined }),
    ).toBeUndefined();
    expect(
      await model.mergeStateIf(row.id, { cursor: 'accepted' }, { cursor: null }),
    ).toBeDefined();
    expect((await model.findById(row.id))?.state.cursor).toBe('accepted');
  });

  it('validates both CAS patches and expectations before writing', async () => {
    const row = await model.create(input());
    await expect(model.mergeStateIf(row.id, { cursor: 42 } as never, {})).rejects.toThrow();
    await expect(
      model.mergeStateIf(row.id, { cursor: 'new' }, { cursor: 42 } as never),
    ).rejects.toThrow();
    expect((await model.findById(row.id))?.state).toEqual({});
  });

  it('cascades on hard-deleted topics', async () => {
    const row = await model.create(input());
    await db.delete(topics).where(eq(topics.id, topicId));
    expect(await model.findById(row.id)).toBeUndefined();
  });
});

describe('InboundWebhookModel maintenance and quotas', () => {
  it('finds due finite leases/deletions and stale incomplete subscriptions only', async () => {
    const due = new Date(Date.now() - 1000);
    const active = await model.create(input({ status: 'active', nextMaintenanceAt: due }));
    const deleting = await model.create(input({ status: 'deleting', nextMaintenanceAt: due }));
    const stale = await model.create(input({ createdAt: new Date(Date.now() - 601_000) }));
    await model.create(input({ status: 'active', state: { refreshBefore: null } }));
    await model.create(
      input({ status: 'active', nextMaintenanceAt: new Date(Date.now() + 60_000) }),
    );
    await model.create(input({ status: 'terminated', nextMaintenanceAt: due }));
    await model.create(input());
    expect((await InboundWebhookModel.queryMaintenance(db)).map((r) => r.id).sort()).toEqual(
      [active.id, deleting.id].sort(),
    );
    expect(await InboundWebhookModel.queryMaintenance(db, 1)).toHaveLength(1);
    expect((await InboundWebhookModel.queryStalePending(db)).map((r) => r.id)).toEqual([stale.id]);
  });

  it('atomically reserves a bounded number of wakes and resets an expired hour', async () => {
    const row = await model.create(input({ status: 'active' }));
    const reservations = await Promise.all(
      Array.from({ length: 8 }, () => model.reserveWake(row.id, 3)),
    );
    expect(reservations.filter(Boolean)).toHaveLength(3);
    expect((await model.findById(row.id))?.wakeCount).toBe(3);
    await db
      .update(inboundWebhooks)
      .set({ wakeWindowStartedAt: new Date(Date.now() - 3_600_001) })
      .where(eq(inboundWebhooks.id, row.id));
    expect(await model.reserveWake(row.id, 3)).toBe(true);
    expect((await model.findById(row.id))?.wakeCount).toBe(1);
  });

  it('returns failed-start reservations without going negative or crossing user scope', async () => {
    const row = await model.create(input({ status: 'active' }));
    expect(await model.reserveWake(row.id, 1)).toBe(true);
    await otherModel.releaseWake(row.id);
    expect(await model.reserveWake(row.id, 1)).toBe(false);
    await model.releaseWake(row.id);
    expect(await model.reserveWake(row.id, 1)).toBe(true);
    await Promise.all(Array.from({ length: 4 }, () => model.releaseWake(row.id)));
    expect((await model.findById(row.id))?.wakeCount).toBe(0);
  });

  it('applies topic and user limits, including subscriptions being created or deleted', async () => {
    await model.createWithLimits(input({ status: 'deleting' }), { topic: 1, user: 2 });
    await expect(model.createWithLimits(input(), { topic: 1, user: 2 })).rejects.toBeInstanceOf(
      InboundWebhookLimitError,
    );
    await model.createWithLimits(input({ topicId: null }), { topic: 1, user: 2 });
    await expect(
      model.createWithLimits(input({ topicId: null }), { topic: 1, user: 2 }),
    ).rejects.toMatchObject({ code: 'limit_reached', message: expect.stringContaining('user') });
  });

  it('serializes quota checks from simultaneous subscription requests', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => model.createWithLimits(input(), { topic: 2, user: 2 })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(await model.query({ includeHidden: true })).toHaveLength(2);
  });
});

describe('InboundWebhookModel delivery recovery', () => {
  it('scopes recovery and preserves current non-delivery errors and deletion state', async () => {
    const row = await model.create(input({ status: 'error', lastError: 'http_5xx' }));
    await otherModel.recordDelivery(row.id, true);
    expect(await model.findById(row.id)).toMatchObject({
      status: 'error',
      lastError: 'http_5xx',
      lastDeliveryAt: null,
    });
    await model.recordDelivery(row.id, false);
    expect(await model.findById(row.id)).toMatchObject({ status: 'error', lastError: 'http_5xx' });
    await model.recordDelivery(row.id, true);
    expect(await model.findById(row.id)).toMatchObject({
      status: 'active',
      lastError: null,
      lastDeliveryAt: expect.any(Date),
    });
    await model.update(row.id, { status: 'error', lastError: 'auth' });
    await model.recordDelivery(row.id, true);
    expect(await model.findById(row.id)).toMatchObject({ status: 'error', lastError: 'auth' });
    await model.update(row.id, { status: 'deleting', lastError: 'http_5xx' });
    await model.recordDelivery(row.id, true);
    expect(await model.findById(row.id)).toMatchObject({
      status: 'deleting',
      lastError: 'http_5xx',
    });
  });
});
