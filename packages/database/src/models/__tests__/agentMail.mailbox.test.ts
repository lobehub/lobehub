// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { FtsSearchRepo } from '../../repositories/ftsSearch';
import { PgLikeFtsSearchBackend } from '../../repositories/ftsSearch/pgLike';
import {
  agentAccounts,
  agentInboxMessages,
  agentMails,
  agents,
  signals,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentAccountModel } from '../agentAccount';
import { AgentInboxModel } from '../agentInbox';
import type { RecordAgentMailParams } from '../agentMail';
import { AGENT_MAIL_SEARCH_POOL, AgentMailModel } from '../agentMail';
import { AgentMailDraftModel } from '../agentMailDraft';
import { SignalModel } from '../signal';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'mailbox-model-user';
const otherUserId = 'mailbox-model-other';
const agentId = 'mailbox-model-agent';

let accountId = '';
let model: AgentMailModel;
let counter = 0;

const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes));

const seed = async (overrides: Partial<RecordAgentMailParams> = {}) => {
  counter += 1;
  const { mail } = await AgentMailModel.record(
    serverDB,
    {
      accountId,
      agentId,
      deliveredAt: at(counter),
      direction: 'inbound',
      fromAddress: 'alice@example.com',
      messageId: `<m${counter}@x>`,
      provider: 'agent-mail',
      providerMessageId: `msg_${counter}`,
      subject: `subject ${counter}`,
      text: `body ${counter}`,
      to: [{ address: 'agent@lobe.id' }],
      ...overrides,
    },
    { userId },
  );

  if (mail.direction === 'inbound') {
    await AgentInboxModel.deliver(
      serverDB,
      {
        accountId,
        agentId,
        preview: mail.text,
        receivedAt: mail.deliveredAt,
        sender: mail.fromAddress,
        sourceId: mail.id,
        sourceType: 'mail',
        threadKey: mail.threadKey,
        title: mail.subject,
      },
      { userId },
    );
  }

  return mail;
};

const listIds = async (folder: 'inbox' | 'sent' | 'starred' | 'trash') =>
  (await model.listConversations({ agentId, folder })).map((row) => row.id);

beforeEach(async () => {
  await serverDB
    .insert(users)
    .values([{ id: userId }, { id: otherUserId }])
    .onConflictDoNothing();
  await serverDB.insert(agents).values({ id: agentId, userId }).onConflictDoNothing();
  const account = await new AgentAccountModel(serverDB, userId).create({
    agentId,
    capabilities: { receive: true, send: true },
    identifier: 'agent@lobe.id',
    kind: 'mail',
    provider: 'agent-mail',
  });
  accountId = account.id;
  model = new AgentMailModel(serverDB, userId);
});

afterEach(async () => {
  await serverDB.delete(agentAccounts).where(eq(agentAccounts.id, accountId));
  await serverDB.delete(agents).where(eq(agents.id, agentId));
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
});

describe('folders', () => {
  it('separates inbox, sent, starred and trash', async () => {
    const received = await seed();
    const sent = await seed({ direction: 'outbound', fromAddress: 'agent@lobe.id' });
    const binned = await seed();
    await model.moveToTrash([binned.id]);
    await model.setStarred([received.id], true);

    expect(await listIds('inbox')).toEqual([received.id]);
    expect(await listIds('sent')).toEqual([sent.id]);
    expect(await listIds('starred')).toEqual([received.id]);
    expect(await listIds('trash')).toEqual([binned.id]);
  });

  it('collapses a thread into one row showing its newest mail and size', async () => {
    await seed({ threadKey: 'thread-1' });
    const newest = await seed({ threadKey: 'thread-1' });
    const alone = await seed();

    const rows = await model.listConversations({ agentId, folder: 'inbox' });

    expect(rows.map((row) => row.id)).toEqual([alone.id, newest.id]);
    expect(rows[1].mailCount).toBe(2);
    expect(rows[1].isUnread).toBe(true);
  });

  it('pages by cursor without overlap', async () => {
    const first = await seed();
    const second = await seed();
    const third = await seed();

    const page1 = await model.listConversations({ agentId, folder: 'inbox', limit: 2 });
    const last = page1.at(-1)!;
    const page2 = await model.listConversations({
      agentId,
      before: { id: last.id, sortAt: last.sortAt },
      folder: 'inbox',
      limit: 2,
    });

    expect(page1.map((row) => row.id)).toEqual([third.id, second.id]);
    expect(page2.map((row) => row.id)).toEqual([first.id]);
  });

  it('pages whole conversations, so a thread is never split across pages', async () => {
    const older = await seed({ threadKey: 'thread-a' });
    const lone = await seed();
    const newest = await seed({ threadKey: 'thread-a' });
    await model.setStarred([older.id], true);

    const page1 = await model.listConversations({ agentId, folder: 'inbox', limit: 1 });
    const last = page1.at(-1)!;
    const page2 = await model.listConversations({
      agentId,
      before: { id: last.id, sortAt: last.sortAt },
      folder: 'inbox',
      limit: 1,
    });
    const page3 = await model.listConversations({
      agentId,
      before: { id: page2[0].id, sortAt: page2[0].sortAt },
      folder: 'inbox',
      limit: 1,
    });

    expect(page1).toMatchObject([{ id: newest.id, isStarred: true, mailCount: 2 }]);
    expect(page2).toMatchObject([{ id: lone.id, isStarred: false, mailCount: 1 }]);
    expect(page3).toEqual([]);
  });

  it('builds a conversation from the mails in the view only', async () => {
    const kept = await seed({ threadKey: 'thread-b' });
    const binned = await seed({ threadKey: 'thread-b' });
    await model.moveToTrash([binned.id]);

    expect(await model.listConversations({ agentId, folder: 'inbox' })).toMatchObject([
      { id: kept.id, mailCount: 1 },
    ]);
    expect(await model.listConversations({ agentId, folder: 'trash' })).toMatchObject([
      { id: binned.id, mailCount: 1 },
    ]);
  });

  it('narrows the view to the given mails', async () => {
    const hit = await seed({ threadKey: 'thread-c' });
    await seed({ threadKey: 'thread-c' });
    await seed();

    expect(await model.listConversations({ agentId, mailIds: [hit.id] })).toMatchObject([
      { id: hit.id, mailCount: 1 },
    ]);
    expect(await model.listConversations({ agentId, mailIds: [] })).toEqual([]);
  });

  it('shows nothing to a user outside the scope', async () => {
    const mail = await seed();
    const stranger = new AgentMailModel(serverDB, otherUserId);

    expect(await stranger.listConversations({ agentId, folder: 'inbox' })).toEqual([]);
    expect(await stranger.findById(mail.id)).toBeUndefined();
    expect(await stranger.moveToTrash([mail.id])).toEqual([]);
    expect(await stranger.setStarred([mail.id], true)).toBe(0);
    expect(await stranger.listPurgeTargets([mail.id])).toEqual([]);
  });
});

describe('search', () => {
  const pgLikeSearch = (forUserId = userId) =>
    new AgentMailModel(
      serverDB,
      forUserId,
      undefined,
      new FtsSearchRepo(serverDB, forUserId, undefined, undefined, {
        backend: new PgLikeFtsSearchBackend(serverDB, { userId: forUserId }),
        ftsSearchCandidateEnabled: true,
      }),
    );

  const seedFindable = async () => ({
    byBody: await seed({ text: 'the zebra crossing' }),
    byRecipient: await seed({
      direction: 'outbound',
      fromAddress: 'agent@lobe.id',
      to: [{ address: 'carol@corp.dev', name: 'Carol Danvers' }],
    }),
    bySender: await seed({ fromAddress: 'billing@acme.io', fromName: 'Acme' }),
    bySubject: await seed({ subject: 'Quarterly INVOICE' }),
  });

  it('matches subject, sender, recipients and body, case-insensitively', async () => {
    const { byBody, byRecipient, bySender, bySubject } = await seedFindable();
    const search = pgLikeSearch();
    const find = async (query: string) =>
      (await search.searchConversations({ agentId, query })).items.map((row) => row.id);

    expect(await find('invoice')).toEqual([bySubject.id]);
    expect(await find('ACME.IO')).toEqual([bySender.id]);
    expect(await find('zebra')).toEqual([byBody.id]);
    expect(await find('carol@corp')).toEqual([byRecipient.id]);
    expect(await find('Danvers')).toEqual([byRecipient.id]);
  });

  it('matches recipient values, never the JSON around them', async () => {
    await seed({ to: [{ address: 'dave@x.io' }] });

    const result = await pgLikeSearch().searchConversations({ agentId, query: 'address' });

    expect(result).toEqual({ items: [], truncated: false });
  });

  it('leaves trash out, treats wildcards literally and keeps to the scope', async () => {
    const binned = await seed({ text: 'needle' });
    await model.moveToTrash([binned.id]);
    const live = await seed({ text: 'needle in plain sight' });

    const search = pgLikeSearch();
    expect(
      (await search.searchConversations({ agentId, query: 'needle' })).items.map((row) => row.id),
    ).toEqual([live.id]);
    expect((await search.searchConversations({ agentId, query: '%' })).items).toEqual([]);
    expect(
      (await pgLikeSearch(otherUserId).searchConversations({ agentId, query: 'needle' })).items,
    ).toEqual([]);
  });

  it('builds conversations from the matching mails only', async () => {
    await seed({ text: 'unrelated', threadKey: 'search-thread' });
    const hit = await seed({ text: 'the pelican brief', threadKey: 'search-thread' });

    const { items } = await pgLikeSearch().searchConversations({ agentId, query: 'pelican' });

    expect(items).toMatchObject([{ id: hit.id, mailCount: 1 }]);
  });

  it('fails loudly instead of searching some other way', async () => {
    await seed({ text: 'anything' });

    await expect(model.searchConversations({ agentId, query: 'anything' })).rejects.toThrow(
      'Agent mail search needs the full-text search repository',
    );

    const broken = new AgentMailModel(serverDB, userId, undefined, {
      ftsSearchCandidateEnabled: true,
      ftsSearchCandidates: async () => {
        throw new Error('elasticsearch unreachable');
      },
    });
    await expect(broken.searchConversations({ agentId, query: 'anything' })).rejects.toThrow(
      'elasticsearch unreachable',
    );
  });

  it('says when the provider dropped matches past the pool', async () => {
    const mail = await seed({ text: 'pooled' });
    const capped = new AgentMailModel(serverDB, userId, undefined, {
      ftsSearchCandidateEnabled: true,
      ftsSearchCandidates: async () => ({
        candidates: [{ id: mail.id, score: 1 }],
        total: AGENT_MAIL_SEARCH_POOL + 50,
      }),
    });

    expect(await capped.searchConversations({ agentId, query: 'pooled' })).toMatchObject({
      items: [{ id: mail.id }],
      truncated: true,
    });
  });

  describe.skipIf(process.env.TEST_SERVER_DB !== '1')('with pg_search', () => {
    // pg_search keeps candidate mode off and answers from agent_mails_bm25_idx.
    const pgSearch = () =>
      new AgentMailModel(serverDB, userId, undefined, {
        ftsSearchCandidateEnabled: false,
        ftsSearchCandidates: async () => {
          throw new Error('candidate mode is off under pg_search');
        },
      });

    it('matches subject, sender, recipients and body through the BM25 index', async () => {
      const { byBody, byRecipient, bySender, bySubject } = await seedFindable();
      const binned = await seed({ text: 'zebra stripes' });
      await model.moveToTrash([binned.id]);
      const find = async (query: string) =>
        (await pgSearch().searchConversations({ agentId, query })).items.map((row) => row.id);

      expect(await find('invoice')).toEqual([bySubject.id]);
      expect(await find('acme')).toEqual([bySender.id]);
      expect(await find('zebra')).toEqual([byBody.id]);
      expect(await find('carol')).toEqual([byRecipient.id]);
    });
  });
});

describe('read state', () => {
  const inboxRow = async (mailId: string) => {
    const [row] = await serverDB
      .select()
      .from(agentInboxMessages)
      .where(eq(agentInboxMessages.sourceId, mailId));
    return row;
  };

  it('marks unread without clearing read_at, so wakes do not repeat', async () => {
    const mail = await seed();
    await model.markRead([mail.id]);
    const readAt = (await inboxRow(mail.id)).readAt;
    expect(readAt).not.toBeNull();

    await model.markUnread([mail.id]);

    expect((await inboxRow(mail.id)).readAt).toEqual(readAt);
    expect((await model.findById(mail.id))?.isUnread).toBe(true);
    expect(await model.countUnread({ agentId })).toBe(1);
    expect(await AgentInboxModel.claimWake(serverDB, (await inboxRow(mail.id)).id)).toBe(false);
  });

  it('marking read clears the request again', async () => {
    const mail = await seed();
    await model.markUnread([mail.id]);

    await model.markRead([mail.id]);

    expect((await model.findById(mail.id))?.isUnread).toBe(false);
    expect(await model.countUnread({ agentId })).toBe(0);
  });

  it('counts unread mail and drafts of many addresses in one call', async () => {
    const other = await new AgentAccountModel(serverDB, userId).create({
      agentId,
      capabilities: { receive: true, send: true },
      identifier: 'second@lobe.id',
      kind: 'mail',
      provider: 'agent-mail',
    });
    await seed();
    await seed();
    const read = await seed({ accountId: other.id });
    await seed({ accountId: other.id });
    await model.markRead([read.id]);
    await new AgentMailDraftModel(serverDB, userId).create({
      accountId: other.id,
      agentId,
      mode: 'compose',
    });

    const unread = await model.countUnreadByAccount([accountId, other.id]);
    expect(unread.sort((a, b) => b.unread - a.unread)).toEqual([
      { accountId, unread: 2 },
      { accountId: other.id, unread: 1 },
    ]);
    expect(
      await new AgentMailDraftModel(serverDB, userId).countByAccount([accountId, other.id]),
    ).toEqual([{ accountId: other.id, drafts: 1 }]);
    expect(
      await new AgentMailModel(serverDB, otherUserId).countUnreadByAccount([accountId]),
    ).toEqual([]);
    expect(await model.countUnreadByAccount([])).toEqual([]);
  });

  it('flags a manually unread mail on the inbox summary and clears it on mark all read', async () => {
    const inbox = new AgentInboxModel(serverDB, userId);
    const marked = await seed();
    const unread = await seed();
    await model.markRead([marked.id]);
    await model.markUnread([marked.id, unread.id]);

    const itemIdOf = new Map(
      await Promise.all(
        [marked.id, unread.id].map(async (id) => [id, (await inboxRow(id)).id] as const),
      ),
    );
    const summaries = await inbox.listSummaries({ agentId });
    const flagOf = (mailId: string) =>
      summaries.find((row) => row.id === itemIdOf.get(mailId))?.markedUnread;
    expect(flagOf(marked.id)).toBe(true);
    expect(flagOf(unread.id)).toBe(true);

    // Two items: one still unread *and* marked unread, one only marked.
    expect(await inbox.markAllRead(agentId)).toBe(2);
    expect(await model.countUnread({ agentId })).toBe(0);
    expect((await inbox.listSummaries({ agentId })).every((row) => !row.markedUnread)).toBe(true);
  });

  it('counts sent mail as read until asked otherwise', async () => {
    const sent = await seed({ direction: 'outbound', fromAddress: 'agent@lobe.id' });

    expect((await model.findById(sent.id))?.isUnread).toBe(false);
    await model.markUnread([sent.id]);
    expect((await model.findById(sent.id))?.isUnread).toBe(true);
  });
});

describe('bulk and conversations', () => {
  it('applies one action to many mails and reports how many changed', async () => {
    const a = await seed();
    const b = await seed();

    expect(await model.setStarred([a.id, b.id], true)).toBe(2);
    expect((await model.moveToTrash([a.id, b.id])).sort()).toEqual([a.id, b.id].sort());
    expect(await model.moveToTrash([a.id, b.id])).toEqual([]);
    expect(await model.restore([a.id, b.id])).toBe(2);
    expect(await listIds('inbox')).toHaveLength(2);
  });

  it('keeps the star across trash and restore', async () => {
    const mail = await seed();
    await model.setStarred([mail.id], true);
    await model.moveToTrash([mail.id]);
    expect(await listIds('starred')).toEqual([]);

    await model.restore([mail.id]);

    expect(await listIds('starred')).toEqual([mail.id]);
  });

  it('expands an id to the conversation inside one view only', async () => {
    const first = await seed({ threadKey: 't' });
    const sent = await seed({
      direction: 'outbound',
      fromAddress: 'agent@lobe.id',
      threadKey: 't',
    });
    await seed({ threadKey: 'other' });

    expect((await model.expandToConversations([first.id], 'inbox')).sort()).toEqual([first.id]);
    expect(await model.expandToConversations([first.id], 'sent')).toEqual([sent.id]);
  });

  it('reads a conversation oldest first, in both directions', async () => {
    const first = await seed({ threadKey: 't' });
    const reply = await seed({
      direction: 'outbound',
      fromAddress: 'agent@lobe.id',
      threadKey: 't',
    });

    const rows = await model.listConversation({ id: reply.id });

    expect(rows.map((row) => row.id)).toEqual([first.id, reply.id]);
  });

  it('opens a conversation from its inbox item id too', async () => {
    const first = await seed({ threadKey: 'thread-inbox' });
    const second = await seed({ threadKey: 'thread-inbox' });
    const [item] = await serverDB
      .select({ id: agentInboxMessages.id })
      .from(agentInboxMessages)
      .where(eq(agentInboxMessages.sourceId, second.id));

    const rows = await model.listConversation({ id: item.id });

    expect(rows.map((row) => row.id)).toEqual([first.id, second.id]);
    expect(
      await new AgentMailModel(serverDB, otherUserId).listConversation({ id: item.id }),
    ).toEqual([]);
  });

  it('reads a mail with no thread as a conversation of one', async () => {
    const mail = await seed();
    await seed();

    expect((await model.listConversation({ id: mail.id })).map((row) => row.id)).toEqual([mail.id]);
  });

  it('keeps trash and the live view of a conversation apart', async () => {
    const first = await seed({ threadKey: 't' });
    const second = await seed({ threadKey: 't' });
    await model.moveToTrash([first.id]);

    expect((await model.listConversation({ id: second.id })).map((row) => row.id)).toEqual([
      second.id,
    ]);
    expect(
      (await model.listConversation({ folder: 'trash', id: first.id })).map((row) => row.id),
    ).toEqual([first.id]);
  });
});

describe('purge', () => {
  it('only accepts what is already in the trash', async () => {
    const mail = await seed();

    expect(await model.listPurgeTargets([mail.id])).toEqual([]);
    expect(await model.purge([mail.id])).toBe(0);
    expect((await model.findById(mail.id))?.purgedAt).toBeNull();
  });

  it('wipes subject, body, recipients and codes, keeping only what idempotency needs', async () => {
    const { signal } = await SignalModel.record(
      serverDB,
      {
        accountId,
        agentId,
        externalId: `evt_purge_${counter}`,
        payload: { data: { message: { codes: ['839201'], subject: 'secret' } } },
        source: 'agent-mail',
        type: 'message.received',
      },
      { userId },
    );
    const mail = await seed({
      cc: [{ address: 'c@x.io' }],
      codes: ['839201'],
      fromName: 'Alice',
      signalId: signal.id,
      subject: 'secret',
      text: 'secret body',
    });
    await model.moveToTrash([mail.id]);

    expect(await model.purge([mail.id])).toBe(1);

    const [row] = await serverDB.select().from(agentMails).where(eq(agentMails.id, mail.id));
    expect(row).toMatchObject({
      bcc: [],
      cc: [],
      codes: [],
      fromAddress: 'alice@example.com',
      fromName: null,
      providerMessageId: mail.providerMessageId,
      subject: null,
      text: '',
      to: [],
    });
    expect(row.purgedAt).not.toBeNull();

    const [item] = await serverDB
      .select()
      .from(agentInboxMessages)
      .where(eq(agentInboxMessages.sourceId, mail.id));
    expect(item).toMatchObject({ preview: null, sender: 'alice@example.com', title: null });

    // The webhook payload is a second copy of the subject and codes.
    const [stored] = await serverDB.select().from(signals).where(eq(signals.id, signal.id));
    expect(stored.payload).toEqual({});
    expect(stored.payloadPurgedAt).not.toBeNull();
  });

  it('disappears from every view and cannot be restored', async () => {
    const mail = await seed();
    await model.moveToTrash([mail.id]);
    await model.purge([mail.id]);

    expect(await listIds('trash')).toEqual([]);
    expect(await model.findById(mail.id)).toBeUndefined();
    expect(await model.restore([mail.id])).toBe(0);
  });

  it('cannot be restored while a purge holds it, and can once the claim is handed back', async () => {
    const mail = await seed();
    await model.moveToTrash([mail.id]);

    expect(await model.claimForPurge([mail.id])).toEqual([mail.id]);
    expect(await model.claimForPurge([mail.id])).toEqual([]);
    expect(await model.restore([mail.id])).toBe(0);
    expect(await model.listTrashTargets({ accountId, limit: 10 })).toEqual([]);

    await model.releasePurge([mail.id]);
    expect(await model.restore([mail.id])).toBe(1);
  });

  it('does not claim a mail that was restored first', async () => {
    const mail = await seed();
    await model.moveToTrash([mail.id]);
    await model.restore([mail.id]);

    expect(await model.claimForPurge([mail.id])).toEqual([]);
  });

  it('forgets who a purged sent mail went to', async () => {
    const sent = await seed({
      cc: [{ address: 'carol@x.io', name: 'Carol' }],
      direction: 'outbound',
      fromAddress: 'agent@lobe.id',
      threadKey: 'purged-thread',
      to: [{ address: 'bob@x.io', name: 'Bob' }],
    });
    await model.moveToTrash([sent.id]);
    await model.purge([sent.id]);

    const [row] = await serverDB.select().from(agentMails).where(eq(agentMails.id, sent.id));
    expect(row.to).toEqual([]);
    expect(row.cc).toEqual([]);
    // A reply from them no longer counts as answering the agent in that thread.
    for (const address of ['bob@x.io', 'carol@x.io']) {
      expect(
        await AgentMailModel.hasSentInThreadTo(serverDB, {
          accountId,
          address,
          threadKey: 'purged-thread',
        }),
      ).toBe(false);
    }
  });

  it('keeps a provider retry from delivering the mail afresh', async () => {
    const mail = await seed();
    await model.moveToTrash([mail.id]);
    await model.purge([mail.id]);

    const { created } = await AgentMailModel.record(
      serverDB,
      {
        accountId,
        agentId,
        deliveredAt: new Date(),
        direction: 'inbound',
        fromAddress: 'alice@example.com',
        provider: 'agent-mail',
        providerMessageId: mail.providerMessageId,
        text: 'again',
      },
      { userId },
    );

    expect(created).toBe(false);
  });
});

describe('agent paths and the trash', () => {
  const itemOf = async (mailId: string) => {
    const [row] = await serverDB
      .select()
      .from(agentInboxMessages)
      .where(eq(agentInboxMessages.sourceId, mailId));
    return row;
  };

  it('does not wake on trashed or purged mail', async () => {
    const trashed = await seed();
    const purged = await seed();
    await model.moveToTrash([trashed.id, purged.id]);
    await model.purge([purged.id]);

    expect(await AgentInboxModel.claimWake(serverDB, (await itemOf(trashed.id)).id)).toBe(false);
    expect(await AgentInboxModel.claimWake(serverDB, (await itemOf(purged.id)).id)).toBe(false);
  });

  it('still wakes on live mail, and again once restored', async () => {
    const mail = await seed();
    await model.moveToTrash([mail.id]);
    await model.restore([mail.id]);

    expect(await AgentInboxModel.claimWake(serverDB, (await itemOf(mail.id)).id)).toBe(true);
  });

  it('leaves trashed mail out of the default read, the wait poll and the counts', async () => {
    const inbox = new AgentInboxModel(serverDB, userId);
    const live = await seed();
    const trashed = await seed();
    await model.moveToTrash([trashed.id]);

    const read = await inbox.list({ agentId, excludeDiscarded: true });
    const waited = await inbox.listSince({ agentId, since: new Date(0) });

    expect(read.map((row) => row.sourceId)).toEqual([live.id]);
    expect(waited.map((row) => row.sourceId)).toEqual([live.id]);
    expect(await inbox.unreadCount(agentId)).toBe(1);
    expect(await AgentInboxModel.unreadCountForAgent(serverDB, agentId)).toBe(1);
  });

  it('keeps trashed mail visible to the reply and relay checks', async () => {
    const inbox = new AgentInboxModel(serverDB, userId);
    const trashed = await seed({
      codes: ['839201'],
      deliveredAt: new Date(),
      fromAddress: 'bank@example.com',
      threadKey: 't',
    });
    await model.moveToTrash([trashed.id]);

    const thread = await inbox.list({ accountId, agentId, threadKey: 't' });
    const codes = await model.listCodesFromOtherSenders({
      agentId,
      recipient: 'attacker@example.com',
      since: new Date(0),
    });

    expect(thread.map((row) => row.sourceId)).toEqual([trashed.id]);
    expect(codes).toEqual([{ code: '839201', from: 'bank@example.com' }]);
  });
});
