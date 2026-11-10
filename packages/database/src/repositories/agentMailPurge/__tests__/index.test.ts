// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { AgentAccountModel } from '../../../models/agentAccount';
import { AgentMailModel } from '../../../models/agentMail';
import type * as SignalModule from '../../../models/signal';
import { SignalModel } from '../../../models/signal';
import { agentAccounts, agentMails, agents, signals, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { AgentMailPurgeRepository } from '../index';

// Lets a test make the signal payload write fail inside the purge transaction.
const failPayloads = vi.hoisted(() => ({ value: false }));
vi.mock('../../../models/signal', async (importOriginal) => {
  const actual = await importOriginal<typeof SignalModule>();
  class SignalModel extends actual.SignalModel {
    constructor(...args: ConstructorParameters<typeof actual.SignalModel>) {
      super(...args);
      const purgePayloads = this.purgePayloads;
      this.purgePayloads = async (ids) => {
        if (failPayloads.value) throw new Error('signals unavailable');
        return purgePayloads(ids);
      };
    }
  }
  return { ...actual, SignalModel };
});

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'mail-purge-repo-user';
const otherUserId = 'mail-purge-repo-other';
const agentId = 'mail-purge-repo-agent';

let accountId = '';
let counter = 0;

const seedTrashed = async () => {
  counter += 1;
  const { signal } = await SignalModel.record(
    serverDB,
    {
      accountId,
      agentId,
      externalId: `evt_purge_repo_${counter}`,
      payload: { data: { message: { codes: ['839201'], subject: 'secret' } } },
      source: 'agent-mail',
      type: 'message.received',
    },
    { userId },
  );
  const { mail } = await AgentMailModel.record(
    serverDB,
    {
      accountId,
      agentId,
      codes: ['839201'],
      deliveredAt: new Date(),
      direction: 'inbound',
      fromAddress: 'alice@example.com',
      provider: 'agent-mail',
      providerMessageId: `msg_purge_repo_${counter}`,
      signalId: signal.id,
      subject: 'secret',
      text: 'secret body',
    },
    { userId },
  );
  await new AgentMailModel(serverDB, userId).moveToTrash([mail.id]);

  return { mail, signal };
};

const payloadOf = async (signalId: string) => {
  const [row] = await serverDB.select().from(signals).where(eq(signals.id, signalId));
  return row.payload;
};

beforeEach(async () => {
  await serverDB
    .insert(users)
    .values([{ id: userId }, { id: otherUserId }])
    .onConflictDoNothing();
  await serverDB.insert(agents).values({ id: agentId, userId }).onConflictDoNothing();
  const account = await new AgentAccountModel(serverDB, userId).create({
    agentId,
    capabilities: { receive: true, send: true },
    identifier: 'purge-repo@lobe.id',
    kind: 'mail',
    provider: 'agent-mail',
  });
  accountId = account.id;
});

afterEach(async () => {
  failPayloads.value = false;
  await serverDB.delete(agentAccounts).where(eq(agentAccounts.id, accountId));
  await serverDB.delete(agents).where(eq(agents.id, agentId));
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
});

describe('AgentMailPurgeRepository', () => {
  it('wipes the mail and the payload of the signal it arrived as', async () => {
    const { mail, signal } = await seedTrashed();

    expect(await new AgentMailPurgeRepository(serverDB, userId).purge([mail.id])).toEqual([
      mail.id,
    ]);

    const [row] = await serverDB.select().from(agentMails).where(eq(agentMails.id, mail.id));
    expect(row).toMatchObject({ codes: [], subject: null, text: '' });
    expect(await payloadOf(signal.id)).toEqual({});
  });

  it('keeps the mail purgeable when blanking the payload fails', async () => {
    const { mail, signal } = await seedTrashed();
    failPayloads.value = true;

    await expect(new AgentMailPurgeRepository(serverDB, userId).purge([mail.id])).rejects.toThrow(
      'signals unavailable',
    );

    const [row] = await serverDB.select().from(agentMails).where(eq(agentMails.id, mail.id));
    expect(row).toMatchObject({ purgedAt: null, subject: 'secret' });
    expect(await payloadOf(signal.id)).not.toEqual({});

    failPayloads.value = false;
    expect(await new AgentMailPurgeRepository(serverDB, userId).purge([mail.id])).toEqual([
      mail.id,
    ]);
    expect(await payloadOf(signal.id)).toEqual({});
  });

  it('touches nothing outside the caller scope', async () => {
    const { mail, signal } = await seedTrashed();

    expect(await new AgentMailPurgeRepository(serverDB, otherUserId).purge([mail.id])).toEqual([]);
    expect(await payloadOf(signal.id)).not.toEqual({});
  });
});
