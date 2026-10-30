// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentAccounts, agentInboxMessages, agentMails, agents, signals, users } from '..';

const serverDB = await getTestDB();
const userId = 'agent-signals-schema-user';
const agentId = 'agent-signals-schema-agent';

const migrationsFolder = path.join(__dirname, '../../../migrations');

const createAccount = async () => {
  const [account] = await serverDB
    .insert(agentAccounts)
    .values({
      agentId,
      capabilities: { receive: true, send: true },
      identifier: 'signals-schema@lobe.id',
      kind: 'mail',
      provider: 'agent-mail',
      status: 'active',
      userId,
    })
    .returning();
  return account;
};

const signal = (accountId: string | null, externalId = 'evt_1') => ({
  accountId,
  agentId,
  externalId,
  payload: { id: externalId },
  source: 'agent-mail',
  type: 'message.received',
  userId,
});

const mail = (accountId: string, providerMessageId = 'msg_1', signalId?: string) => ({
  accountId,
  agentId,
  deliveredAt: new Date('2026-10-02T00:00:00Z'),
  direction: 'inbound' as const,
  fromAddress: 'human@example.com',
  provider: 'agent-mail',
  providerMessageId,
  signalId,
  text: 'hello',
  userId,
});

const inboxItem = (accountId: string, mailId: string) => ({
  accountId,
  agentId,
  receivedAt: new Date('2026-10-02T00:00:00Z'),
  sender: 'human@example.com',
  sourceId: mailId,
  sourceType: 'mail' as const,
  userId,
});

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId }).onConflictDoNothing();
  await serverDB.insert(agents).values({ id: agentId, userId }).onConflictDoNothing();
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('signals', () => {
  it('records each outside event once, however often the source redelivers it', async () => {
    const account = await createAccount();
    const [first] = await serverDB.insert(signals).values(signal(account.id)).returning();

    expect(first).toMatchObject({ attempts: 0, error: null, status: 'pending' });
    await expect(serverDB.insert(signals).values(signal(account.id))).rejects.toThrow();
  });

  it('outlives the account it was addressed to, as a record of what the world sent', async () => {
    const account = await createAccount();
    const [row] = await serverDB.insert(signals).values(signal(account.id)).returning();

    await serverDB.delete(agentAccounts).where(eq(agentAccounts.id, account.id));

    const [kept] = await serverDB.select().from(signals).where(eq(signals.id, row.id));
    expect(kept).toMatchObject({ accountId: null, externalId: 'evt_1' });
  });
});

describe('agent_mails and agent_inbox_messages', () => {
  it('stores one mail per provider message and one inbox item per mail', async () => {
    const account = await createAccount();
    const [origin] = await serverDB.insert(signals).values(signal(account.id)).returning();
    const [row] = await serverDB
      .insert(agentMails)
      .values(mail(account.id, 'msg_1', origin.id))
      .returning();

    expect(row).toMatchObject({ attachments: [], cc: [], codes: [], references: [], to: [] });
    await expect(serverDB.insert(agentMails).values(mail(account.id))).rejects.toThrow();

    await serverDB.insert(agentInboxMessages).values(inboxItem(account.id, row.id));
    await expect(
      serverDB.insert(agentInboxMessages).values(inboxItem(account.id, row.id)),
    ).rejects.toThrow();

    const [item] = await serverDB.select().from(agentInboxMessages);
    expect(item).toMatchObject({
      readAt: null,
      topicId: null,
      waitConsumedBy: [],
      wakeClaimedAt: null,
    });
  });

  it('removes the mail and its inbox item with the account, but keeps the signal', async () => {
    const account = await createAccount();
    const [origin] = await serverDB.insert(signals).values(signal(account.id)).returning();
    const [row] = await serverDB
      .insert(agentMails)
      .values(mail(account.id, 'msg_1', origin.id))
      .returning();
    await serverDB.insert(agentInboxMessages).values(inboxItem(account.id, row.id));

    await serverDB.delete(agentAccounts).where(eq(agentAccounts.id, account.id));

    expect(await serverDB.select().from(agentMails)).toHaveLength(0);
    expect(await serverDB.select().from(agentInboxMessages)).toHaveLength(0);
    expect(await serverDB.select().from(signals).where(eq(signals.id, origin.id))).toHaveLength(1);
  });
});

describe('migration 0183', () => {
  it('converges when re-run on a database that already has it', async () => {
    const statements = readFileSync(
      path.join(migrationsFolder, '0183_project_order_and_agent_signals.sql'),
      'utf8',
    )
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter(Boolean);

    for (const statement of statements) {
      await serverDB.execute(sql.raw(statement));
    }
  });

  it('adds the manual project order and makes the identifier optional', async () => {
    const columns = await serverDB.execute<{
      column_name: string;
      is_nullable: string;
    }>(sql`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_name = 'projects' AND column_name IN ('identifier', 'sort_order')
      ORDER BY column_name
    `);

    expect(columns.rows).toEqual([
      { column_name: 'identifier', is_nullable: 'YES' },
      { column_name: 'sort_order', is_nullable: 'YES' },
    ]);
  });
});
