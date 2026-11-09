// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import type { NewAgentInboxMessage } from '../../schemas';
import {
  agentAccounts,
  agentInboxMessages,
  agents,
  topics,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentAccountModel } from '../agentAccount';
import { AgentInboxModel } from '../agentInbox';
import { AgentMailModel } from '../agentMail';

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 'inbox-coverage-owner';
const otherId = 'inbox-coverage-other';
const workspaceId = 'inbox-coverage-ws';
const agentId = 'inbox-coverage-agent';
const otherAgentId = 'inbox-coverage-other-agent';

const scope = { userId: ownerId, workspaceId };

let accountId = '';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: ownerId }, { id: otherId }]);
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: workspaceId, primaryOwnerId: ownerId, slug: workspaceId })
    .onConflictDoNothing();
  await serverDB.insert(agents).values([
    { id: agentId, userId: ownerId, visibility: 'private', workspaceId },
    { id: otherAgentId, userId: ownerId, visibility: 'private', workspaceId },
  ]);

  const account = await new AgentAccountModel(serverDB, ownerId, undefined, workspaceId).create({
    agentId,
    capabilities: { receive: true, send: true },
    identifier: 'coverage@lobe.id',
    kind: 'mail',
    provider: 'agent-mail',
  });
  accountId = account.id;
});

afterEach(async () => {
  await serverDB.delete(agentInboxMessages);
  await serverDB.delete(agentAccounts);
  await serverDB.delete(agents);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
  vi.restoreAllMocks();
});

/** One inbox row, written the way the inbound edge writes it. */
const seedItem = async (overrides: Partial<NewAgentInboxMessage> = {}) => {
  const [row] = await serverDB
    .insert(agentInboxMessages)
    .values({
      accountId,
      agentId,
      receivedAt: new Date('2026-10-01T00:00:00.000Z'),
      sender: 'login@service.com',
      sourceId: randomUUID(),
      sourceType: 'mail',
      userId: ownerId,
      workspaceId,
      ...overrides,
    })
    .returning();

  return row;
};

describe('AgentInboxModel.deliver idempotency', () => {
  it('returns the stored item instead of writing a second row for the same source record', async () => {
    const sourceId = randomUUID();
    const params = {
      accountId,
      agentId,
      preview: 'Your code',
      receivedAt: new Date('2026-10-01T00:00:00.000Z'),
      sender: 'login@service.com',
      sourceId,
      sourceType: 'mail' as const,
      threadKey: 'thread-1',
      title: 'Your verification code',
    };

    const first = await AgentInboxModel.deliver(serverDB, params, scope);
    const again = await AgentInboxModel.deliver(serverDB, params, scope);

    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.item.id).toBe(first.item.id);
    expect(again.item.threadKey).toBe('thread-1');

    const rows = await serverDB.select().from(agentInboxMessages);
    expect(rows).toHaveLength(1);
  });

  it('delivers an item that carries neither an account, a preview nor a title', async () => {
    const { created, item } = await AgentInboxModel.deliver(
      serverDB,
      {
        agentId,
        receivedAt: new Date('2026-10-01T00:00:00.000Z'),
        sender: 'someone@service.com',
        sourceId: randomUUID(),
        sourceType: 'mail',
      },
      scope,
    );

    expect(created).toBe(true);
    expect(item).toMatchObject({ accountId: null, preview: null, threadKey: null, title: null });
  });
});

describe('AgentInboxModel unscoped reads', () => {
  it('reads one item with the content of the record it points at', async () => {
    const { mail } = await AgentMailModel.record(
      serverDB,
      {
        accountId,
        agentId,
        attachments: [{ contentType: 'application/pdf', filename: 'invoice.pdf', index: 0 }],
        codes: ['839201'],
        deliveredAt: new Date('2026-10-02T12:00:00.000Z'),
        direction: 'inbound',
        fromAddress: 'login@service.com',
        provider: 'agent-mail',
        providerMessageId: 'msg_entry',
        subject: 'Invoice',
        text: 'Code 839201',
        to: [{ address: 'coverage@lobe.id' }],
      },
      scope,
    );
    const { item } = await AgentInboxModel.deliver(
      serverDB,
      {
        accountId,
        agentId,
        receivedAt: mail.deliveredAt,
        sender: mail.fromAddress,
        sourceId: mail.id,
        sourceType: 'mail',
        title: mail.subject,
      },
      scope,
    );

    expect(await AgentInboxModel.findEntry(serverDB, item.id)).toMatchObject({
      attachments: [{ contentType: 'application/pdf', filename: 'invoice.pdf', index: 0 }],
      codes: ['839201'],
      from: 'login@service.com',
      subject: 'Invoice',
      text: 'Code 839201',
      to: 'coverage@lobe.id',
    });

    expect(
      await AgentInboxModel.findEntry(serverDB, '00000000-0000-0000-0000-000000000000'),
    ).toBeUndefined();
  });

  it('resolves the topic an earlier wake on the thread ran in', async () => {
    const first = await seedItem({ threadKey: 'thread-topic' });
    const second = await seedItem({
      receivedAt: new Date('2026-10-03T00:00:00.000Z'),
      threadKey: 'thread-topic',
    });

    // Nothing in this thread has woken yet.
    expect(
      await AgentInboxModel.findThreadTopicId(serverDB, { accountId, threadKey: 'thread-topic' }),
    ).toBeUndefined();

    // A wake stamps the topic it ran in; the next item of the thread follows it.
    await serverDB.insert(topics).values([
      { agentId, id: 'topic-older', title: 'older', userId: ownerId },
      { agentId, id: 'topic-newer', title: 'newer', userId: ownerId },
    ]);

    await AgentInboxModel.markWoken(serverDB, first.id, 'topic-older');
    await AgentInboxModel.markWoken(serverDB, second.id, 'topic-newer');

    // The newest item of the thread decides where the next one continues.
    expect(
      await AgentInboxModel.findThreadTopicId(serverDB, { accountId, threadKey: 'thread-topic' }),
    ).toBe('topic-newer');
    // An unknown thread resolves to nothing rather than throwing.
    expect(
      await AgentInboxModel.findThreadTopicId(serverDB, { accountId, threadKey: 'thread-unknown' }),
    ).toBeUndefined();
  });

  it('counts unread items of one agent and arrivals in a recent window', async () => {
    const unread = await seedItem();
    await seedItem({
      readAt: new Date('2026-10-01T00:00:00.000Z'),
      sender: 'other@service.com',
    });

    expect(await AgentInboxModel.unreadCountForAgent(serverDB, agentId)).toBe(1);
    expect(await AgentInboxModel.countRecent(serverDB, { accountId, since: new Date(0) })).toBe(2);
    expect(
      await AgentInboxModel.countRecent(serverDB, {
        accountId,
        from: 'login@service.com',
        since: new Date(0),
      }),
    ).toBe(1);

    // Both statics are keyed on the agent / account, not on the caller.
    expect(await AgentInboxModel.unreadCountForAgent(serverDB, otherAgentId)).toBe(0);
    expect(
      await new AgentInboxModel(serverDB, ownerId, workspaceId).countForAccount(accountId),
    ).toBe(2);
    expect(unread.readAt).toBeNull();
  });
});

describe('AgentInboxModel.markRead', () => {
  it('is a no-op for an empty id list', async () => {
    await seedItem();

    expect(await new AgentInboxModel(serverDB, ownerId, workspaceId).markRead([])).toBe(0);
  });
});

describe('AgentInboxModel.markWaitConsumed', () => {
  it('keeps an item a wait already returned out of that operation’s next poll', async () => {
    const consumed = await seedItem({ sender: 'login@service.com' });
    const fresh = await seedItem({ sender: 'login@service.com' });
    const model = new AgentInboxModel(serverDB, ownerId, workspaceId);

    await model.markWaitConsumed(consumed.id, 'op-1');

    expect(
      (await model.listSince({ agentId, since: new Date(0), notConsumedBy: 'op-1' })).map(
        (row) => row.id,
      ),
    ).toEqual([fresh.id]);

    // Another operation still sees it: consumption is per operation, not a read marker.
    expect(
      (await model.listSince({ agentId, since: new Date(0), notConsumedBy: 'op-2' })).map(
        (row) => row.id,
      ),
    ).toEqual([consumed.id, fresh.id]);

    const [row] = await serverDB
      .select()
      .from(agentInboxMessages)
      .where(eq(agentInboxMessages.id, consumed.id));
    expect(row.waitConsumedBy).toEqual(['op-1']);
    expect(row.readAt).toBeNull();
  });
});

describe('AgentInboxModel.list filters', () => {
  it('pages by keyset cursor so pages never overlap', async () => {
    const oldest = await seedItem({ receivedAt: new Date('2026-10-01T00:00:00.000Z') });
    const middle = await seedItem({ receivedAt: new Date('2026-10-02T00:00:00.000Z') });
    const newest = await seedItem({ receivedAt: new Date('2026-10-03T00:00:00.000Z') });
    const model = new AgentInboxModel(serverDB, ownerId, workspaceId);

    const firstPage = await model.list({ agentId, limit: 2 });
    expect(firstPage.map((row) => row.id)).toEqual([newest.id, middle.id]);

    const secondPage = await model.list({
      agentId,
      before: { id: middle.id, receivedAt: middle.receivedAt },
    });
    expect(secondPage.map((row) => row.id)).toEqual([oldest.id]);
  });

  it('narrows by account, thread, arrival instant and unread state', async () => {
    const matching = await seedItem({ threadKey: 'thread-a' });
    const read = await seedItem({
      readAt: new Date('2026-10-02T00:00:00.000Z'),
      receivedAt: new Date('2026-10-05T00:00:00.000Z'),
      threadKey: 'thread-a',
    });
    await seedItem({
      accountId: null,
      receivedAt: new Date('2026-09-01T00:00:00.000Z'),
      threadKey: 'thread-b',
    });
    const model = new AgentInboxModel(serverDB, ownerId, workspaceId);

    expect((await model.list({ accountId })).map((row) => row.id).sort()).toEqual(
      [matching.id, read.id].sort(),
    );
    expect(
      (await model.list({ agentId, threadKey: 'thread-b' })).map((row) => row.id),
    ).toHaveLength(1);
    expect(
      (await model.list({ agentId, receivedAfter: new Date('2026-10-04T00:00:00.000Z') })).map(
        (row) => row.id,
      ),
    ).toEqual([read.id]);
    const unread = (await model.list({ agentId, unreadOnly: true })).map((row) => row.id);
    expect(unread).toContain(matching.id);
    expect(unread).not.toContain(read.id);
  });
});

describe('AgentInboxModel.listSummaries filters', () => {
  it('applies the same page and filters as list', async () => {
    const oldest = await seedItem({ receivedAt: new Date('2026-10-01T00:00:00.000Z') });
    const middle = await seedItem({ receivedAt: new Date('2026-10-02T00:00:00.000Z') });
    const newest = await seedItem({ receivedAt: new Date('2026-10-03T00:00:00.000Z') });
    const model = new AgentInboxModel(serverDB, ownerId, workspaceId);

    expect((await model.listSummaries({ agentId, limit: 2 })).map((row) => row.id)).toEqual([
      newest.id,
      middle.id,
    ]);
    expect(
      (
        await model.listSummaries({
          agentId,
          before: { id: middle.id, receivedAt: middle.receivedAt },
        })
      ).map((row) => row.id),
    ).toEqual([oldest.id]);

    expect((await model.listSummaries({ accountId })).map((row) => row.id)).toHaveLength(3);
    expect((await model.listSummaries({ agentId, threadKey: 'thread-missing' })).length).toBe(0);
    expect(
      (
        await model.listSummaries({
          agentId,
          receivedAfter: new Date('2026-10-02T12:00:00.000Z'),
        })
      ).map((row) => row.id),
    ).toEqual([newest.id]);
    expect(await model.listSummaries({ agentId, unreadOnly: true })).toHaveLength(3);
  });
});

describe('AgentInboxModel.findEntryById', () => {
  it('reads one entry for its owner and hides it from another user', async () => {
    const item = await seedItem();

    await expect(
      new AgentInboxModel(serverDB, ownerId, workspaceId).findEntryById(item.id),
    ).resolves.toMatchObject({ id: item.id, sourceType: 'mail' });
    await expect(
      new AgentInboxModel(serverDB, otherId, workspaceId).findEntryById(item.id),
    ).resolves.toBeUndefined();
  });
});

describe('AgentInboxModel.listSince filters', () => {
  it('narrows by account, sender and subject, with the subject pattern escaped', async () => {
    const matching = await seedItem({
      sender: 'alerts@service.com',
      title: 'Build 100% done_today',
    });
    await seedItem({ sender: 'other@service.com', title: 'Build 100% done_today' });
    await seedItem({ accountId: null, sender: 'alerts@service.com', title: 'Daily digest' });
    const model = new AgentInboxModel(serverDB, ownerId, workspaceId);

    expect(
      (
        await model.listSince({
          accountId,
          agentId,
          from: 'alerts@service.com',
          since: new Date(0),
        })
      ).map((row) => row.id),
    ).toEqual([matching.id]);

    const bySubject = await model.listSince({
      agentId,
      since: new Date(0),
      subjectIncludes: '100%',
    });
    expect(bySubject).toHaveLength(2);
    expect(bySubject.every((row) => row.subject === 'Build 100% done_today')).toBe(true);

    // `_` is a wildcard in LIKE; escaping it looks for the literal character.
    expect(
      (await model.listSince({ agentId, since: new Date(0), subjectIncludes: 'done_today' })).map(
        (row) => row.id,
      ),
    ).toHaveLength(2);
    expect(
      await model.listSince({ agentId, since: new Date(0), subjectIncludes: 'doneXtoda' }),
    ).toHaveLength(0);
  });
});

describe('AgentInboxModel count fallbacks', () => {
  /**
   * `count()` always yields one row, so `?? 0` is a driver-level guard: a
   * backend that answers with no row must not hand `undefined` to the caller.
   */
  const stubEmptyAggregate = () =>
    vi.spyOn(serverDB, 'select').mockReturnValueOnce({
      from: () => ({ where: async () => [] }),
    } as unknown as ReturnType<LobeChatDatabase['select']>);

  it('degrades unreadCount to 0 when the aggregate returns no row', async () => {
    stubEmptyAggregate();

    expect(await new AgentInboxModel(serverDB, ownerId, workspaceId).unreadCount(agentId)).toBe(0);
  });

  it('degrades unreadCountForAgent to 0 when the aggregate returns no row', async () => {
    stubEmptyAggregate();

    expect(await AgentInboxModel.unreadCountForAgent(serverDB, agentId)).toBe(0);
  });

  it('degrades countRecent to 0 when the aggregate returns no row', async () => {
    stubEmptyAggregate();

    expect(await AgentInboxModel.countRecent(serverDB, { accountId, since: new Date(0) })).toBe(0);
  });

  it('degrades countForAccount to 0 when the aggregate returns no row', async () => {
    stubEmptyAggregate();

    expect(
      await new AgentInboxModel(serverDB, ownerId, workspaceId).countForAccount(accountId),
    ).toBe(0);
  });
});
