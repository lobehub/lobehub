// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentAccounts, agents, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentAccountModel } from '../agentAccount';
import { AgentInboxModel } from '../agentInbox';
import type { RecordAgentMailParams } from '../agentMail';
import { AgentMailModel } from '../agentMail';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'agent-mail-model-user';
const agentId = 'agent-mail-model-agent';
const AGENT_ADDRESS = 'agent@lobe.id';

let accountId = '';

const mail = (overrides: Partial<RecordAgentMailParams>): RecordAgentMailParams => ({
  accountId,
  agentId,
  deliveredAt: new Date(),
  direction: 'inbound',
  fromAddress: 'login@service.com',
  provider: 'agent-mail',
  providerMessageId: 'msg_1',
  text: 'hello',
  ...overrides,
});

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId }).onConflictDoNothing();
  await serverDB.insert(agents).values({ id: agentId, userId }).onConflictDoNothing();
  const account = await new AgentAccountModel(serverDB, userId).create({
    agentId,
    capabilities: { receive: true, send: true },
    identifier: AGENT_ADDRESS,
    kind: 'mail',
    provider: 'agent-mail',
  });
  accountId = account.id;
});

afterEach(async () => {
  await serverDB.delete(agentAccounts);
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('AgentMailModel', () => {
  it('records a provider message once, with its sender normalized for comparison', async () => {
    const first = await AgentMailModel.record(
      serverDB,
      mail({ fromAddress: '  Login@Service.COM ' }),
      { userId },
    );
    const again = await AgentMailModel.record(serverDB, mail({}), { userId });

    expect(first).toMatchObject({ created: true, mail: { fromAddress: 'login@service.com' } });
    expect(again).toMatchObject({ created: false, mail: { id: first.mail.id } });
  });

  it("never treats the agent's own sent mail as another sender's secret", async () => {
    // The agent itself once sent this token out — to the same person it now
    // replies to. That is its own text, not something another sender gave it.
    await AgentMailModel.record(
      serverDB,
      mail({
        codes: ['111111'],
        direction: 'outbound',
        fromAddress: AGENT_ADDRESS,
        providerMessageId: 'msg_sent',
        text: 'Your invite token is AB12CD34EF, code 111111',
      }),
      { userId },
    );
    const model = new AgentMailModel(serverDB, userId);
    const window = { agentId, recipient: 'friend@example.com', since: new Date(0) };

    expect(await model.listCodesFromOtherSenders(window)).toEqual([]);
    expect(
      await model.findTextFromOtherSender({ ...window, candidates: ['ab12cd34ef'] }),
    ).toBeUndefined();

    // The same token in mail someone else sent the agent does count.
    await AgentMailModel.record(
      serverDB,
      mail({
        codes: ['111111'],
        providerMessageId: 'msg_in',
        text: 'Token AB12CD34EF, code 111111',
      }),
      { userId },
    );
    expect(await model.listCodesFromOtherSenders(window)).toEqual([
      { code: '111111', from: 'login@service.com' },
    ]);
    expect(await model.findTextFromOtherSender({ ...window, candidates: ['ab12cd34ef'] })).toEqual({
      from: 'login@service.com',
    });
  });

  it('reads a thread whole, what arrived and what the agent sent', async () => {
    await AgentMailModel.record(
      serverDB,
      mail({ deliveredAt: new Date('2026-10-02T00:00:00Z'), threadKey: 't1' }),
      { userId },
    );
    await AgentMailModel.record(
      serverDB,
      mail({
        deliveredAt: new Date('2026-10-02T00:05:00Z'),
        direction: 'outbound',
        fromAddress: AGENT_ADDRESS,
        providerMessageId: 'msg_reply',
        threadKey: 't1',
      }),
      { userId },
    );

    const thread = await new AgentMailModel(serverDB, userId).listThread({
      accountId,
      threadKey: 't1',
    });

    expect(thread.map((row) => row.direction)).toEqual(['inbound', 'outbound']);
  });
});

describe('AgentInboxModel entries', () => {
  it('reads an inbox item together with its mail content and attachments', async () => {
    const { mail: row } = await AgentMailModel.record(
      serverDB,
      mail({
        attachments: [{ contentType: 'application/pdf', filename: 'invoice.pdf', index: 0 }],
        codes: ['839201'],
        subject: 'Invoice',
        text: 'Code 839201',
        to: [{ address: AGENT_ADDRESS }],
      }),
      { userId },
    );
    await AgentInboxModel.deliver(
      serverDB,
      {
        accountId,
        agentId,
        receivedAt: row.deliveredAt,
        sender: row.fromAddress,
        sourceId: row.id,
        sourceType: 'mail',
        title: row.subject,
      },
      { userId },
    );

    const [entry] = await new AgentInboxModel(serverDB, userId).list({ agentId });

    expect(entry).toMatchObject({
      attachments: [{ contentType: 'application/pdf', filename: 'invoice.pdf', index: 0 }],
      codes: ['839201'],
      from: 'login@service.com',
      providerMessageId: 'msg_1',
      sourceType: 'mail',
      subject: 'Invoice',
      text: 'Code 839201',
      to: AGENT_ADDRESS,
    });
  });
});
