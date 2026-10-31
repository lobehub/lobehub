// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentAccounts, agentMails, agents, signalDecisions, signals, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { SignalDecisionModel } from '../signalDecision';
import { SignalRetentionModel } from '../signalRetention';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'signal-retention-user';
const otherUserId = 'signal-retention-other-user';
const agentId = 'signal-retention-agent';
const now = new Date('2026-10-24T12:00:00Z');

/** `age` is in minutes so newer rows have a smaller number. */
const seed = async (
  externalId: string,
  age: number,
  overrides: Partial<typeof signals.$inferInsert> = {},
) => {
  const [row] = await serverDB
    .insert(signals)
    .values({
      createdAt: new Date(now.getTime() - age * 60_000),
      externalId,
      payload: { text: externalId },
      scopeKey: 'discord:app-1:thread-1',
      source: 'bot:discord',
      type: 'bot.message.merged',
      userId,
      ...overrides,
    })
    .returning();
  return row;
};

const remaining = async () =>
  (await serverDB.select({ externalId: signals.externalId }).from(signals))
    .map((r) => r.externalId)
    .sort();

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(agents).values({ id: agentId, userId });
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('SignalRetentionModel.pruneOverflow', () => {
  it('keeps the newest N rows of a bucket and deletes the older ones', async () => {
    for (let i = 1; i <= 6; i++) await seed(`m${i}`, i);

    const result = await SignalRetentionModel.pruneOverflow(serverDB, { keepPerSource: 3 });

    expect(result).toEqual({ buckets: 1, deleted: 3 });
    expect(await remaining()).toEqual(['m1', 'm2', 'm3']);
  });

  it('counts each (user, channel, source) bucket separately', async () => {
    for (let i = 1; i <= 4; i++) await seed(`a${i}`, i);
    for (let i = 1; i <= 2; i++) await seed(`b${i}`, i, { scopeKey: 'discord:app-1:thread-2' });
    for (let i = 1; i <= 2; i++) await seed(`c${i}`, i, { source: 'bot:telegram' });
    for (let i = 1; i <= 2; i++) await seed(`d${i}`, i, { userId: otherUserId });

    await SignalRetentionModel.pruneOverflow(serverDB, { keepPerSource: 2 });

    expect(await remaining()).toEqual(['a1', 'a2', 'b1', 'b2', 'c1', 'c2', 'd1', 'd2']);
  });

  it('treats rows without a channel as one bucket per source', async () => {
    for (let i = 1; i <= 4; i++) await seed(`n${i}`, i, { scopeKey: null });

    await SignalRetentionModel.pruneOverflow(serverDB, { keepPerSource: 2 });

    expect(await remaining()).toEqual(['n1', 'n2']);
  });

  it('never deletes a signal a decision points at, and does not count it toward the quota', async () => {
    const woken = await seed('woken', 50);
    await seed('labelled-by-decision', 40);
    for (let i = 1; i <= 4; i++) await seed(`m${i}`, i);
    const decisions = new SignalDecisionModel(serverDB, userId);
    const labelled = (
      await serverDB.select().from(signals).where(eq(signals.externalId, 'labelled-by-decision'))
    )[0];
    for (const [signalId, outcome] of [
      [woken.id, 'wake'],
      [labelled.id, 'skip'],
    ] as const) {
      const decision = await decisions.record({
        agentId,
        outcome,
        pipelineVersion: 'bot-wake@1',
        scopeKey: 'discord:app-1:thread-1',
        signalId,
      });
      await decisions.addLabel(decision!.id, { label: 'correct', source: 'user' });
    }

    await SignalRetentionModel.pruneOverflow(serverDB, { keepPerSource: 2 });

    expect(await remaining()).toEqual(['labelled-by-decision', 'm1', 'm2', 'woken']);
    expect(await serverDB.select().from(signalDecisions)).toHaveLength(2);
  });

  it('never deletes a signal a mail was parsed from', async () => {
    const [account] = await serverDB
      .insert(agentAccounts)
      .values({
        agentId,
        capabilities: { receive: true, send: true },
        identifier: 'retention@lobe.id',
        kind: 'mail',
        provider: 'agent-mail',
        status: 'active',
        userId,
      })
      .returning();
    const old = await seed('mail-old', 90, { accountId: account.id, source: 'agent-mail' });
    await seed('mail-1', 1, { source: 'agent-mail' });
    await seed('mail-2', 2, { source: 'agent-mail' });
    await serverDB.insert(agentMails).values({
      accountId: account.id,
      agentId,
      deliveredAt: now,
      direction: 'inbound',
      fromAddress: 'human@example.com',
      provider: 'agent-mail',
      providerMessageId: 'pm-1',
      signalId: old.id,
      text: 'hello',
      userId,
    });

    await SignalRetentionModel.pruneOverflow(serverDB, { keepPerSource: 1 });

    expect(await remaining()).toEqual(['mail-1', 'mail-old']);
  });

  it('does nothing when every bucket is within quota, and defaults to 10000', async () => {
    for (let i = 1; i <= 3; i++) await seed(`m${i}`, i);

    expect(await SignalRetentionModel.pruneOverflow(serverDB)).toEqual({ buckets: 0, deleted: 0 });
    expect(await remaining()).toEqual(['m1', 'm2', 'm3']);
  });

  it('is repeatable: a second sweep finds nothing left to delete', async () => {
    for (let i = 1; i <= 5; i++) await seed(`m${i}`, i);

    await SignalRetentionModel.pruneOverflow(serverDB, { keepPerSource: 2 });

    expect(await SignalRetentionModel.pruneOverflow(serverDB, { keepPerSource: 2 })).toEqual({
      buckets: 0,
      deleted: 0,
    });
  });
});

describe('SignalRetentionModel.purgeExpiredPayloads', () => {
  it('blanks payloads past the TTL, including promoted rows, and leaves fresh ones alone', async () => {
    const old = await seed('old', 3 * 24 * 60);
    await seed('fresh', 10);
    await new SignalDecisionModel(serverDB, userId).record({
      agentId,
      outcome: 'wake',
      pipelineVersion: 'bot-wake@1',
      scopeKey: 'discord:app-1:thread-1',
      signalId: old.id,
    });

    const result = await SignalRetentionModel.purgeExpiredPayloads(serverDB, {
      now,
      payloadTtlMs: 24 * 60 * 60 * 1000,
    });

    expect(result).toEqual({ purged: 1 });
    const rows = await serverDB
      .select()
      .from(signals)
      .where(inArray(signals.externalId, ['old', 'fresh']));
    const byId = Object.fromEntries(rows.map((r) => [r.externalId, r]));
    expect(byId.old).toMatchObject({ payload: {}, payloadPurgedAt: now });
    expect(byId.fresh).toMatchObject({ payload: { text: 'fresh' }, payloadPurgedAt: null });
  });

  it('keeps metadata when it blanks the payload', async () => {
    const metadata = {
      address: { platform: 'discord', platformThreadId: 'thread-1' },
      entryPoint: 'onSubscribedMessage',
    };
    await seed('old', 3 * 24 * 60, { metadata });

    await SignalRetentionModel.purgeExpiredPayloads(serverDB, {
      now,
      payloadTtlMs: 24 * 60 * 60 * 1000,
    });

    const [row] = await serverDB.select().from(signals).where(eq(signals.externalId, 'old'));
    expect(row).toMatchObject({ metadata, payload: {}, payloadPurgedAt: now });
  });

  it('does not purge the same row twice', async () => {
    await seed('old', 3 * 24 * 60);
    const options = { now, payloadTtlMs: 24 * 60 * 60 * 1000 };

    await SignalRetentionModel.purgeExpiredPayloads(serverDB, options);

    expect(await SignalRetentionModel.purgeExpiredPayloads(serverDB, options)).toEqual({
      purged: 0,
    });
  });

  it('honours the per-call row limit', async () => {
    for (let i = 1; i <= 3; i++) await seed(`old${i}`, 3 * 24 * 60 + i);

    const result = await SignalRetentionModel.purgeExpiredPayloads(serverDB, {
      limit: 2,
      now,
      payloadTtlMs: 24 * 60 * 60 * 1000,
    });

    expect(result).toEqual({ purged: 2 });
  });
});
