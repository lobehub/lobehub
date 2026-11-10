// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { AgentInboxModel } from '@/database/models/agentInbox';
import { AgentMailModel } from '@/database/models/agentMail';
import { agentAccounts, agentInboxMessages, agentMails, agents, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { AgentInboxService } from '../inbox';
import { AgentAccountService } from '../index';
import { AgentMailboxService } from '../mailbox';
import { createAgentMailProvider } from '../providers/agentMail';
import { AgentAccountProviderRegistry } from '../registry';

/**
 * A person's mailbox over the real models, account service and lobe.id client,
 * with only the HTTP edge faked: what is asserted is what reaches the database
 * and the wire.
 */

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'mailbox-chain-user';
const agentId = 'mailbox-chain-agent';
const ADDRESS = 'chain@lobe.id';

let calls: { body?: any; method: string; path: string }[] = [];
let accountId = '';

const gateKeeper = {
  decrypt: async (value: string) => ({ plaintext: value }),
  encrypt: async (value: string) => value,
};

const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
  const path = new URL(String(url)).pathname;
  const method = init?.method ?? 'GET';
  calls.push({ body: init?.body ? JSON.parse(String(init.body)) : undefined, method, path });
  const json = (body: unknown) => new Response(JSON.stringify(body));

  if (method === 'DELETE') return new Response(null, { status: 204 });
  if (method === 'GET') return json({ attachments: [], id: 'x', inboxId: 'inb_chain' });
  if (path.endsWith('/reply')) {
    return json({
      id: 'prov_reply',
      inReplyTo: '<in@x.io>',
      messageId: '<reply@lobe.id>',
      references: ['<root@x.io>', '<in@x.io>'],
    });
  }
  return json({ id: 'prov_new', messageId: '<new@lobe.id>', references: [] });
}) as typeof fetch;

const buildMailbox = () => {
  const registry = new AgentAccountProviderRegistry();
  registry.register(createAgentMailProvider({ apiKey: 'am_test', fetchImpl }));
  const accounts = new AgentAccountService(serverDB, userId, {
    gateKeeper: gateKeeper as any,
    registry,
  });
  return new AgentMailboxService(serverDB, userId, { accounts });
};

const receive = async () => {
  const { entry } = await new AgentInboxService(serverDB, userId).recordInboundMail({
    account: { agentId, id: accountId, identifier: ADDRESS, provider: 'agent-mail' },
    message: {
      from: 'alice@x.io',
      mail: {
        messageId: '<in@x.io>',
        references: ['<root@x.io>'],
        to: [{ address: ADDRESS }],
      },
      providerMessageId: 'prov_in',
      receivedAt: new Date(),
      subject: 'Question',
      text: 'are you there',
      threadKey: '<root@x.io>',
      to: ADDRESS,
    } as any,
  });
  return entry;
};

const onlyAgentMail = async (providerMessageId: string) => {
  const [row] = await serverDB
    .select()
    .from(agentMails)
    .where(eq(agentMails.providerMessageId, providerMessageId));
  return row;
};

beforeEach(async () => {
  calls = [];
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(agents).values({ id: agentId, userId });
  const [account] = await serverDB
    .insert(agentAccounts)
    .values({
      agentId,
      capabilities: { receive: true, send: true },
      identifier: ADDRESS,
      kind: 'mail',
      metadata: { inboxId: 'inb_chain' },
      provider: 'agent-mail',
      status: 'active',
      userId,
    } as any)
    .returning();
  accountId = account.id;
});

describe('a person answering and filing mail', () => {
  it('replies in the thread and the reply shows up under Sent', async () => {
    const mailbox = buildMailbox();
    const entry = await receive();

    await mailbox.send({
      accountId,
      mode: 'reply',
      sourceMailId: entry.sourceId,
      text: 'yes',
    });

    expect(calls.some((call) => call.path === '/v1/messages/prov_in/reply')).toBe(true);
    expect(await onlyAgentMail('prov_reply')).toMatchObject({
      direction: 'outbound',
      inReplyTo: '<in@x.io>',
      messageId: '<reply@lobe.id>',
      references: ['<root@x.io>', '<in@x.io>'],
      threadKey: '<root@x.io>',
    });
    const sent = await mailbox.mail.listConversations({ agentId, folder: 'sent' });
    expect(sent.map((row) => row.subject)).toEqual(['Re: Question']);
    const thread = await mailbox.mail.listConversation({ id: entry.sourceId });
    expect(thread.map((row) => row.direction)).toEqual(['inbound', 'outbound']);
  });

  it('saves a draft, sends it once, and removes it', async () => {
    const mailbox = buildMailbox();
    const draft = await mailbox.drafts.create({
      accountId,
      agentId,
      mode: 'compose',
      subject: 'Hello',
      text: 'first version',
      to: [{ address: 'bob@x.io' }],
    });
    await mailbox.drafts.update(draft!.id, { text: 'final version' });

    await mailbox.sendDraft(draft!.id);

    expect(calls.at(-1)?.body).toMatchObject({ text: 'final version', to: ['bob@x.io'] });
    expect(await mailbox.drafts.findById(draft!.id)).toBeUndefined();
    expect(await onlyAgentMail('prov_new')).toMatchObject({ threadKey: '<new@lobe.id>' });
  });

  it('trashes, restores, then purges on lobe.id and leaves a tombstone', async () => {
    const mailbox = buildMailbox();
    const entry = await receive();

    await mailbox.mail.moveToTrash([entry.sourceId]);
    expect(await AgentInboxModel.claimWake(serverDB, entry.id)).toBe(false);
    await mailbox.mail.restore([entry.sourceId]);
    expect(await mailbox.mail.listConversations({ agentId, folder: 'trash' })).toEqual([]);
    await mailbox.mail.moveToTrash([entry.sourceId]);

    const result = await mailbox.purge(await mailbox.mail.listPurgeTargets([entry.sourceId]));

    expect(result).toEqual({ count: 1, failed: 0 });
    expect(calls).toContainEqual({
      body: undefined,
      method: 'DELETE',
      path: '/v1/messages/prov_in',
    });
    expect(await onlyAgentMail('prov_in')).toMatchObject({ subject: null, text: '' });
    const [item] = await serverDB
      .select()
      .from(agentInboxMessages)
      .where(eq(agentInboxMessages.id, entry.id));
    expect(item.sender).toBe('alice@x.io');
    expect(
      await AgentMailModel.hasSentInThreadTo(serverDB, {
        accountId,
        address: 'nobody@x.io',
        threadKey: '<root@x.io>',
      }),
    ).toBe(false);
  });
});
