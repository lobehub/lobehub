// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { InboundWebhookView } from '@/database/models/inboundWebhook';
import { InboundWebhookModel } from '@/database/models/inboundWebhook';
import { agents, signalDecisions, signals, topics, users } from '@/database/schemas';

import {
  claimWebhookSignals,
  releaseWebhookSignalClaim,
  renewWebhookSignalClaim,
  settleWebhookSignals,
  WEBHOOK_WAKE_LEASE_MS,
} from './wakeClaim';

const db = await getTestDB();
const userId = 'wake-claim-user';
const agentId = 'wake-claim-agent';
const topicId = 'wake-claim-topic';
const model = new InboundWebhookModel(db, userId);
let row: InboundWebhookView;
let signalId: string;
const signal = async () => (await db.select().from(signals).where(eq(signals.id, signalId)))[0];
beforeEach(async () => {
  await db.insert(users).values({ id: userId });
  await db.insert(agents).values({ id: agentId, userId });
  await db.insert(topics).values({ id: topicId, agentId, userId });
  row = await model.create({
    agentId,
    topicId,
    kind: 'mcp_events',
    status: 'active',
    config: { eventName: 'issue.created', arguments: {} },
    verification: { scheme: 'standard_webhooks' },
    state: { truncated: true },
  });
  signalId = (
    await db
      .insert(signals)
      .values({
        agentId,
        userId,
        source: 'mcp-events',
        type: 'issue.created',
        externalId: `${row.id}:event`,
        scopeKey: `inbound-webhook:${row.id}`,
        metadata: { extra: { control: 'gap', retained: 'metadata' } },
      })
      .returning()
  )[0].id;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete(users).where(eq(users.id, userId));
});

describe('durable webhook signal claims', () => {
  it('grants a batch to exactly one concurrent worker and preserves control metadata', async () => {
    const claims = await Promise.all([claimWebhookSignals(db, row), claimWebhookSignals(db, row)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const claim = claims.find(Boolean)!;
    expect((await signal()).metadata.extra).toMatchObject({
      control: 'gap',
      retained: 'metadata',
      inboundWebhookWake: { token: claim.token },
    });
    expect(claim.row.state.truncated).toBe(true);
    expect((await model.findById(row.id))?.state.truncated).toBe(false);
  });

  it('recovers an expired claim after a crash, preserving its consumed gap flag', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const first = (await claimWebhookSignals(db, row))!;
    clock.mockReturnValue(now + WEBHOOK_WAKE_LEASE_MS + 1);
    const second = (await claimWebhookSignals(db, row))!;
    expect(second.token).not.toBe(first.token);
    expect(second.truncated).toBe(true);
    expect(second.row.state.truncated).toBe(true);
    expect(await renewWebhookSignalClaim(db, first)).toBe(false);
    await settleWebhookSignals(db, first, first.batch, 'processed', 'obsolete', 'wrong-op');
    await releaseWebhookSignalClaim(db, first, false);
    expect((await signal()).status).toBe('pending');
    expect((await signal()).metadata.extra?.inboundWebhookWake).toMatchObject({
      token: second.token,
    });
    expect(await db.select().from(signalDecisions)).toHaveLength(0);
    await settleWebhookSignals(
      db,
      second,
      second.batch,
      'processed',
      'event_delivery',
      'correct-op',
    );
    expect((await signal()).status).toBe('processed');
    expect((await db.select().from(signalDecisions))[0].operationId).toBe('correct-op');
  });

  it('renews a live worker beyond its initial lease deadline', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const claim = (await claimWebhookSignals(db, row))!;
    clock.mockReturnValue(now + WEBHOOK_WAKE_LEASE_MS - 1);
    expect(await renewWebhookSignalClaim(db, claim)).toBe(true);
    clock.mockReturnValue(now + WEBHOOK_WAKE_LEASE_MS + 1);
    expect(await claimWebhookSignals(db, row)).toBeUndefined();
  });

  it('never clears a new gap received after the claim was committed', async () => {
    const claim = (await claimWebhookSignals(db, row))!;
    await model.mergeState(row.id, { truncated: true, cursor: 'new-gap' });
    await settleWebhookSignals(db, claim, claim.batch, 'processed', 'event_delivery', 'op');
    await releaseWebhookSignalClaim(db, claim, false);
    expect((await model.findById(row.id))?.state).toMatchObject({
      truncated: true,
      cursor: 'new-gap',
    });
    expect((await signal()).metadata.extra).toEqual({ control: 'gap', retained: 'metadata' });
  });

  it('releases failed work immediately and restores its consumed gap', async () => {
    const claim = (await claimWebhookSignals(db, row))!;
    await settleWebhookSignals(db, claim, claim.batch, 'pending', 'topic_busy');
    await releaseWebhookSignalClaim(db, claim, true);
    expect((await signal()).attempts).toBe(1);
    expect((await model.findById(row.id))?.state.truncated).toBe(true);
    expect((await claimWebhookSignals(db, row))?.token).not.toBe(claim.token);
  });

  it('does not claim events after the endpoint entered deleting', async () => {
    await model.update(row.id, { status: 'deleting' });
    expect(await claimWebhookSignals(db, row)).toBeUndefined();
    expect((await signal()).metadata.extra).not.toHaveProperty('inboundWebhookWake');
  });
});
