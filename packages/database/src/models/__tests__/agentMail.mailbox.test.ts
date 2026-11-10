// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentAccounts, agentInboxMessages, agentMails, agents, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentAccountModel } from '../agentAccount';
import { AgentInboxModel } from '../agentInbox';
import type { RecordAgentMailParams } from '../agentMail';
import { AgentMailModel } from '../agentMail';

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
  it('matches subject, sender, recipients and body, case-insensitively', async () => {
    const bySubject = await seed({ subject: 'Quarterly INVOICE' });
    const bySender = await seed({ fromAddress: 'billing@acme.io', fromName: 'Acme' });
    const byBody = await seed({ text: 'the zebra crossing' });
    const byRecipient = await seed({
      direction: 'outbound',
      fromAddress: 'agent@lobe.id',
      to: [{ address: 'carol@corp.dev' }],
    });
    const find = async (query: string) =>
      (await model.listConversations({ agentId, query })).map((row) => row.id);

    expect(await find('invoice')).toEqual([bySubject.id]);
    expect(await find('ACME.IO')).toEqual([bySender.id]);
    expect(await find('zebra')).toEqual([byBody.id]);
    expect(await find('carol@corp')).toEqual([byRecipient.id]);
  });

  it('leaves trash out and treats wildcards literally', async () => {
    const binned = await seed({ text: 'needle' });
    await model.moveToTrash([binned.id]);
    await seed({ text: 'plain' });

    expect(await model.listConversations({ agentId, query: 'needle' })).toEqual([]);
    expect(await model.listConversations({ agentId, query: '%' })).toEqual([]);
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

  it('wipes the content but keeps the row and what the checks read', async () => {
    const mail = await seed({
      cc: [{ address: 'c@x.io' }],
      codes: ['839201'],
      fromName: 'Alice',
      subject: 'secret',
      text: 'secret body',
    });
    await model.moveToTrash([mail.id]);

    expect(await model.purge([mail.id])).toBe(1);

    const [row] = await serverDB.select().from(agentMails).where(eq(agentMails.id, mail.id));
    expect(row).toMatchObject({
      cc: [],
      codes: ['839201'],
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

  it('keeps who a purged sent mail went to, so replies still wake the agent', async () => {
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
    expect(row.to).toEqual([{ address: 'bob@x.io' }]);
    expect(row.cc).toEqual([{ address: 'carol@x.io' }]);
    for (const address of ['bob@x.io', 'carol@x.io']) {
      expect(
        await AgentMailModel.hasSentInThreadTo(serverDB, {
          accountId,
          address,
          threadKey: 'purged-thread',
        }),
      ).toBe(true);
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
