// @vitest-environment node
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { EmailMessageDetail } from '@lobechat/agent-address-mail';
import { computeAgentMailSignature } from '@lobechat/agent-address-mail';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentAccountModel } from '@/database/models/agentAccount';
import { agentAccounts, agents, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { AgentAccountService } from '../index';
import { createAgentMailProvider } from '../providers/agentMail';
import { createLinqProvider } from '../providers/linq';
import { AgentAccountProviderRegistry } from '../registry';

/**
 * End-to-end evidence run for the identity service chain.
 *
 * Unlike the unit tests, nothing here is stubbed in-process: the service talks
 * to the real `@lobechat/agent-address-mail` client over a loopback HTTP server
 * (a stand-in for the lobe.id tenant that operations has not provisioned yet),
 * against the real Drizzle model on the PGlite test database, with the real
 * AES-GCM KeyVaults gatekeeper. Only the SaaS on the other side of the wire is
 * a fixture — and that is exactly the prerequisite the task says is missing.
 */

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-identity-chain-user';
const agentId = 'agent-identity-chain-agent';
const WEBHOOK_SECRET = 'whsec_e2e_agent_mail';

const mailDetail = (overrides: Partial<EmailMessageDetail> = {}): EmailMessageDetail => ({
  attachments: [],
  bcc: [],
  cc: [],
  codes: [],
  direction: 'inbound',
  envelope: { from: 'human@example.com', to: 'toby-agent@lobe.id' },
  error: null,
  from: { address: 'human@example.com', name: 'Human' },
  html: null,
  id: 'msg_in_e2e',
  inboxId: 'inb_e2e',
  inReplyTo: null,
  links: [],
  messageId: '<m1@example.com>',
  read: false,
  receivedAt: '2026-10-02T00:00:00.000Z',
  references: ['<root@example.com>'],
  replyTo: [],
  size: 42,
  snippet: null,
  status: 'received',
  subject: 'Hello agent',
  text: 'the answer\n\nOn Mon, someone wrote:\n> older history',
  to: [{ address: 'toby-agent@lobe.id' }],
  ...overrides,
});

/** A loopback stand-in for the lobe.id tenant the Agent Mail client talks to. */
const startMockAgentMail = async () => {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk as Buffer));
    req.on('end', () => {
      const method = req.method ?? 'GET';
      const { pathname } = new URL(req.url ?? '/', 'http://127.0.0.1');
      seen.push(`${method} ${pathname}`);

      const json = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };

      if (method === 'POST' && pathname === '/v1/inboxes') {
        return json(200, {
          address: 'toby-agent@lobe.id',
          clientId: 'cli_e2e',
          id: 'inb_e2e',
          metadata: {},
        });
      }
      if (method === 'POST' && pathname === '/v1/webhooks') {
        return json(200, { id: 'wh_e2e', secret: WEBHOOK_SECRET, url: 'http://127.0.0.1/hook' });
      }
      if (method === 'DELETE' && pathname === '/v1/inboxes/inb_e2e') {
        res.writeHead(204);
        return res.end();
      }
      if (method === 'POST' && pathname === '/v1/inboxes/inb_e2e/messages') {
        return json(200, mailDetail({ direction: 'outbound', id: 'msg_out_e2e' }));
      }
      if (method === 'GET' && pathname === '/v1/messages/msg_in_e2e') {
        return json(200, mailDetail());
      }
      if (method === 'GET' && pathname === '/v1/messages/msg_in_e2e/raw') {
        res.writeHead(200, { 'content-type': 'message/rfc822' });
        return res.end('From: human@example.com\r\nSubject: Hello agent\r\n\r\nbody');
      }

      return json(404, { error: { message: `unexpected ${method} ${pathname}` } });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return { baseUrl: `http://127.0.0.1:${port}`, seen, server };
};

let mock: Awaited<ReturnType<typeof startMockAgentMail>>;
let gateKeeper: KeyVaultsGateKeeper;
let service: AgentAccountService;

beforeAll(async () => {
  // A real 32-byte AES-GCM key, so the credential path is exercised for real.
  vi.stubEnv('KEY_VAULTS_SECRET', Buffer.alloc(32, 7).toString('base64'));
  gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  mock = await startMockAgentMail();
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    mock.server.close((error) => (error ? reject(error) : resolve())),
  );
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(agents).values({ id: agentId, userId });

  const registry = new AgentAccountProviderRegistry()
    .register(
      createAgentMailProvider({
        apiBaseUrl: mock.baseUrl,
        apiKey: 'am_e2e',
        webhookUrl: 'http://127.0.0.1/hook',
      }),
    )
    .register(createLinqProvider({ apiKey: 'linq_e2e', fromNumber: '+15550002222' }));

  service = new AgentAccountService(serverDB, userId, { gateKeeper, registry });
});

afterEach(async () => {
  await serverDB.delete(agentAccounts);
  await serverDB.delete(users);
});

describe('Agent identity chain — end to end over loopback', () => {
  it('provisions, sends, receives and revokes across both providers', async () => {
    const transcript: string[] = [];

    // 1. Provision a mail account through the provider (real HTTP round trip).
    const mail = await service.provision({
      agentId,
      displayName: 'Toby mailbox',
      provider: 'agent-mail',
    });
    transcript.push(
      `1. provision(agent-mail) -> ${mail.identifier} kind=${mail.kind} capabilities=${JSON.stringify(mail.capabilities)} hasCredential=${mail.hasCredential}`,
    );
    expect(mail).toMatchObject({
      capabilities: { receive: true, send: true },
      hasCredential: true,
      identifier: 'toby-agent@lobe.id',
      kind: 'mail',
    });

    // 2. Provision a phone account (Linq number comes from deployment config).
    const phone = await service.provision({ agentId, provider: 'linq' });
    transcript.push(
      `2. provision(linq) -> ${phone.identifier} kind=${phone.kind} capabilities=${JSON.stringify(phone.capabilities)}`,
    );
    expect(phone).toMatchObject({ identifier: '+15550002222', kind: 'phone', provider: 'linq' });

    // 3. Reads never carry the ciphertext; the credential is stated, not shown.
    const listed = await service.list({ agentId });
    expect(listed).toHaveLength(2);
    for (const account of listed) expect(account).not.toHaveProperty('credentials');
    transcript.push(`3. list(agentId) -> ${listed.length} accounts, none expose credentials`);

    // 4. The stored column is real ciphertext, not the plaintext secret.
    const [row] = await serverDB
      .select({ credentials: agentAccounts.credentials })
      .from(agentAccounts)
      .where(eq(agentAccounts.id, mail.id));
    transcript.push(
      `4. agent_accounts.credentials -> ${String(row.credentials).slice(0, 24)}… (plaintext leaked=${String(row.credentials).includes(WEBHOOK_SECRET)})`,
    );
    expect(row.credentials).toBeTruthy();
    expect(row.credentials).not.toContain(WEBHOOK_SECRET);
    await expect(
      new AgentAccountModel(serverDB, userId, gateKeeper).getCredential(mail.id),
    ).resolves.toEqual({ webhookSecret: WEBHOOK_SECRET });

    // 5. Send outbound through the provider.
    const sent = await service.send(mail.id, {
      subject: 'Re: Hello agent',
      text: 'hi back',
      to: 'human@example.com',
    });
    transcript.push(`5. send(mail) -> providerMessageId=${sent.providerMessageId}`);
    expect(sent).toEqual({ providerMessageId: 'msg_out_e2e' });

    // 6. Deliver a signed inbound webhook: resolve → verify → normalize.
    const body = JSON.stringify({
      createdAt: '2026-10-02T00:00:00.000Z',
      data: {
        inbox: { address: 'toby-agent@lobe.id', clientId: 'cli_e2e', id: 'inb_e2e' },
        message: { id: 'msg_in_e2e' },
      },
      id: 'evt_e2e',
      type: 'message.received',
    });
    const outcome = await service.handleInbound('agent-mail', {
      body,
      headers: {
        'x-agentmail-signature': computeAgentMailSignature(
          WEBHOOK_SECRET,
          body,
          Math.floor(Date.now() / 1000),
        ),
      },
    });
    if (outcome.outcome !== 'delivered')
      throw new Error(`expected delivered, got ${outcome.outcome}`);
    transcript.push(
      `6. handleInbound(agent-mail) -> ${outcome.outcome} from=${outcome.message.from} to=${outcome.message.to} text=${JSON.stringify(outcome.message.text)}`,
    );
    expect(outcome.message).toMatchObject({
      from: 'human@example.com',
      providerMessageId: 'msg_in_e2e',
      text: 'the answer',
      to: 'toby-agent@lobe.id',
    });

    // 7. A forged delivery produces no message.
    const forged = await service.handleInbound('agent-mail', {
      body,
      headers: { 'x-agentmail-signature': 't=1,v1=deadbeef' },
    });
    transcript.push(`7. handleInbound(forged signature) -> ${forged.outcome}`);
    expect(forged.outcome).toBe('rejected');

    // 8. Revoke: the provider releases its side and the secret is purged.
    await service.revoke(mail.id);
    const revoked = await service.get(mail.id);
    transcript.push(
      `8. revoke(mail) -> status=${revoked!.status} hasCredential=${revoked!.hasCredential} providerReleased=${mock.seen.includes('DELETE /v1/inboxes/inb_e2e')}`,
    );
    expect(revoked).toMatchObject({ hasCredential: false, status: 'revoked' });
    expect(mock.seen).toContain('DELETE /v1/inboxes/inb_e2e');

    transcript.push(`wire: ${mock.seen.join(' | ')}`);
    console.log(`\n[identity-chain]\n${transcript.join('\n')}\n[/identity-chain]\n`);
  });
});
