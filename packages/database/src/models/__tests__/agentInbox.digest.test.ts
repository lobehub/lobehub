// @vitest-environment node
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentAccounts, agentInboxMessages, agents, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentAccountModel } from '../agentAccount';
import { AgentInboxModel, WAKE_CLAIM_LEASE_SECONDS } from '../agentInbox';
import { AgentMailModel } from '../agentMail';
import { SignalModel } from '../signal';
import { SignalDecisionModel } from '../signalDecision';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-inbox-digest-user';
const agentId = 'agent-inbox-digest-agent';
let accountId = '';

/**
 * Lands one mail in the account's inbox, received `minutesAgo` minutes ago. Unless `deferred` is
 * false, a wake decision deferred it to the digest, as the inbound edge records it.
 */
const deliver = async (providerMessageId: string, minutesAgo: number, deferred = true) => {
  const receivedAt = new Date(Date.now() - minutesAgo * 60_000);
  const { signal } = await SignalModel.record(
    serverDB,
    {
      accountId,
      agentId,
      externalId: `evt_${providerMessageId}`,
      source: 'agent-mail',
      type: 'message.received',
    },
    { userId },
  );
  if (deferred) {
    await new SignalDecisionModel(serverDB, userId).record({
      agentId,
      outcome: 'defer',
      pipelineVersion: 'mail-wake@1',
      scopeKey: `agent-mail:${accountId}`,
      signalId: signal.id,
    });
  }
  const { mail } = await AgentMailModel.record(
    serverDB,
    {
      accountId,
      agentId,
      deliveredAt: receivedAt,
      direction: 'inbound',
      fromAddress: `${providerMessageId}@example.com`,
      provider: 'agent-mail',
      providerMessageId,
      signalId: signal.id,
      subject: `Subject ${providerMessageId}`,
      text: `Body ${providerMessageId}`,
      to: [{ address: 'digest@lobe.id' }],
    },
    { userId },
  );
  const { item } = await AgentInboxModel.deliver(
    serverDB,
    {
      accountId,
      agentId,
      receivedAt,
      sender: mail.fromAddress,
      sourceId: mail.id,
      sourceType: 'mail',
      title: mail.subject,
    },
    { userId },
  );

  return item;
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(agents).values({ id: agentId, userId });
  const account = await new AgentAccountModel(serverDB, userId).create({
    agentId,
    capabilities: { receive: true, send: false },
    identifier: 'digest@lobe.id',
    kind: 'mail',
    provider: 'agent-mail',
  });
  accountId = account.id;
});

afterEach(async () => {
  await serverDB.delete(agentInboxMessages);
  await serverDB.delete(agentAccounts);
  await serverDB.delete(users);
});

describe('AgentInboxModel.claimDigest', () => {
  const since = () => new Date(Date.now() - 24 * 60 * 60_000);

  it('takes the held items oldest first, up to the limit, and only once', async () => {
    const newest = await deliver('m3', 1);
    const oldest = await deliver('m1', 30);
    const middle = await deliver('m2', 10);

    expect(
      await AgentInboxModel.claimDigest(serverDB, { accountId, limit: 2, since: since() }),
    ).toEqual([oldest.id, middle.id]);
    expect(
      await AgentInboxModel.claimDigest(serverDB, { accountId, limit: 2, since: since() }),
    ).toEqual([newest.id]);
    expect(
      await AgentInboxModel.claimDigest(serverDB, { accountId, limit: 2, since: since() }),
    ).toEqual([]);
  });

  it('leaves out what was read, what a live wake holds, and what is older than `since`', async () => {
    const read = await deliver('read', 5);
    const woken = await deliver('woken', 5);
    await deliver('old', 3 * 24 * 60);
    const held = await deliver('held', 5);

    await new AgentInboxModel(serverDB, userId).markRead([read.id]);
    expect(await AgentInboxModel.claimWake(serverDB, woken.id)).toBe(true);

    expect(
      await AgentInboxModel.claimDigest(serverDB, { accountId, limit: 10, since: since() }),
    ).toEqual([held.id]);
  });

  it('leaves out mail no wake decision deferred, such as mail stored while wake was off', async () => {
    await deliver('stored', 5, false);
    const held = await deliver('held', 5);

    expect(
      await AgentInboxModel.claimDigest(serverDB, { accountId, limit: 10, since: since() }),
    ).toEqual([held.id]);
  });

  it('takes over an item whose claim outlived its lease', async () => {
    const stale = await deliver('stale', 5);
    await serverDB
      .update(agentInboxMessages)
      .set({
        wakeClaimedAt: sql`now() - make_interval(secs => ${WAKE_CLAIM_LEASE_SECONDS + 60})`,
      })
      .where(eq(agentInboxMessages.id, stale.id));

    expect(
      await AgentInboxModel.claimDigest(serverDB, { accountId, limit: 10, since: since() }),
    ).toEqual([stale.id]);
  });

  it('lets exactly one of two concurrent flushes take each item', async () => {
    const items = await Promise.all(['a', 'b', 'c'].map((id, i) => deliver(id, i + 1)));

    const [first, second] = await Promise.all([
      AgentInboxModel.claimDigest(serverDB, { accountId, limit: 10, since: since() }),
      AgentInboxModel.claimDigest(serverDB, { accountId, limit: 10, since: since() }),
    ]);

    expect([...first, ...second].sort()).toEqual(items.map((item) => item.id).sort());
  });
});

describe('AgentInboxModel.releaseWakes', () => {
  it('gives every claim back in one go, so the next digest can take the items again', async () => {
    const items = await Promise.all(['r1', 'r2'].map((id, i) => deliver(id, i + 1)));
    const since = new Date(Date.now() - 24 * 60 * 60_000);
    const claimed = await AgentInboxModel.claimDigest(serverDB, { accountId, limit: 10, since });
    expect(claimed).toHaveLength(2);

    await AgentInboxModel.releaseWakes(serverDB, claimed);

    expect(
      (await serverDB.select().from(agentInboxMessages)).map((row) => row.wakeClaimedAt),
    ).toEqual([null, null]);
    expect(
      (await AgentInboxModel.claimDigest(serverDB, { accountId, limit: 10, since })).sort(),
    ).toEqual(items.map((item) => item.id).sort());
  });

  it('leaves the claims alone when the run released nothing', async () => {
    const item = await deliver('spare', 1);
    const since = new Date(Date.now() - 24 * 60 * 60_000);
    await AgentInboxModel.claimDigest(serverDB, { accountId, limit: 10, since });

    // An empty digest run never reaches the claim it would have to give back.
    await AgentInboxModel.releaseWakes(serverDB, []);

    const [row] = await serverDB
      .select()
      .from(agentInboxMessages)
      .where(eq(agentInboxMessages.id, item.id));
    expect(row.wakeClaimedAt).not.toBeNull();
  });
});

describe('AgentInboxModel.markManyWoken', () => {
  it('marks every item read and remembers the topic, keeping an earlier read time', async () => {
    const earlier = await deliver('earlier', 9);
    const later = await deliver('later', 1);
    const readAt = new Date('2026-11-01T00:00:00.000Z');
    await serverDB
      .update(agentInboxMessages)
      .set({ readAt })
      .where(eq(agentInboxMessages.id, earlier.id));

    await AgentInboxModel.markManyWoken(serverDB, [earlier.id, later.id], undefined);

    const rows = await serverDB.select().from(agentInboxMessages);
    expect(rows.find((row) => row.id === earlier.id)?.readAt).toEqual(readAt);
    expect(rows.find((row) => row.id === later.id)?.readAt).not.toBeNull();
  });

  it('marks nothing when the digest run has no items', async () => {
    const item = await deliver('untouched', 1);

    await AgentInboxModel.markManyWoken(serverDB, [], undefined);

    const [row] = await serverDB
      .select()
      .from(agentInboxMessages)
      .where(eq(agentInboxMessages.id, item.id));
    expect(row.readAt).toBeNull();
  });
});

describe('AgentInboxModel.isInboxTopic', () => {
  it('tells a topic that holds outside mail from one that does not', async () => {
    const item = await deliver('topic', 1);
    await serverDB.insert(topics).values({ id: 'tpc_digest', userId });
    await AgentInboxModel.markManyWoken(serverDB, [item.id], 'tpc_digest');

    expect(await AgentInboxModel.isInboxTopic(serverDB, 'tpc_digest')).toBe(true);
    expect(await AgentInboxModel.isInboxTopic(serverDB, 'tpc_other')).toBe(false);
  });
});

describe('AgentInboxModel.findEntries', () => {
  it('reads several items with their content, oldest first', async () => {
    const later = await deliver('later', 1);
    const earlier = await deliver('earlier', 9);

    const entries = await AgentInboxModel.findEntries(serverDB, [later.id, earlier.id]);

    expect(entries.map((entry) => [entry.id, entry.subject, entry.text])).toEqual([
      [earlier.id, 'Subject earlier', 'Body earlier'],
      [later.id, 'Subject later', 'Body later'],
    ]);
    expect(await AgentInboxModel.findEntries(serverDB, [])).toEqual([]);
  });
});
