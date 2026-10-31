// @vitest-environment node
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { EmailMessageDetail } from '@lobechat/agent-address-mail';
import { computeAgentMailSignature } from '@lobechat/agent-address-mail';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentAccounts, agents, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { AgentAccountService } from '../index';
import { createAgentMailProvider } from '../providers/agentMail';
import { AgentAccountProviderRegistry } from '../registry';

/**
 * End-to-end evidence run for the **email** link: the whole path a lobe.id
 * Agent Mail address travels, with nothing stubbed in-process.
 *
 * The service talks to the real `@lobechat/agent-address-mail` REST client over
 * a loopback HTTP server (a stand-in for the lobe.id tenant operations has not
 * provisioned yet — that `am_` key and public webhook URL are the prerequisite
 * this task names as missing), against the real Drizzle model on the PGlite
 * test database and the real AES-GCM KeyVaults gatekeeper. Webhook deliveries
 * are signed with the real HMAC-SHA256 scheme Agent Mail uses.
 *
 * The five capabilities the task contract names are each asserted below:
 *   开通     provision — step 1
 *   markdown→HTML       — step 2 (asserted on the bytes that go on the wire)
 *   入站验签 inbound      — steps 3, 5, 6, 8 (signed / forged / foreign)
 *   引用剥离 quote strip  — step 4 (the quoted history never reaches the agent)
 *   释放     release     — step 7 (the inbox is released, send refused, inbound
 *                          stops routing even with a still-valid signature)
 */

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'mail-chain-user';
const agentId = 'mail-chain-agent';

const INBOX_ADDRESS = 'toby-mail@lobe.id';
const INBOX_ID = 'inb_mail_1';
const HUMAN = 'human@example.com';
/** Per-inbox signing secret minted by the webhook registration (the account credential). */
const WEBHOOK_SECRET = 'whsec_mail_chain_secret';
/** Deployment-wide fallback secret, used only when an account carries none. */
const FALLBACK_SECRET = 'whsec_mail_chain_fallback';

/** Frozen clock so the signature tolerance window is deterministic. */
const NOW = Date.parse('2026-10-02T00:00:00.000Z');
const TIMESTAMP = Math.floor(NOW / 1000);

interface MailCall {
  body?: any;
  method: string;
  path: string;
}

const mailDetail = (overrides: Partial<EmailMessageDetail> = {}): EmailMessageDetail => ({
  attachments: [],
  bcc: [],
  cc: [],
  codes: [],
  direction: 'inbound',
  envelope: { from: HUMAN, to: INBOX_ADDRESS },
  error: null,
  from: { address: HUMAN, name: 'Human' },
  html: null,
  id: 'msg_in_1',
  inboxId: INBOX_ID,
  inReplyTo: null,
  links: [],
  messageId: '<m1@example.com>',
  read: false,
  receivedAt: new Date(NOW).toISOString(),
  references: ['<root@example.com>'],
  replyTo: [],
  size: 42,
  snippet: null,
  status: 'received',
  subject: 'Hello agent',
  text: 'the answer',
  to: [{ address: INBOX_ADDRESS }],
  ...overrides,
});

/** A loopback stand-in for the lobe.id Agent Mail tenant. */
const startMockAgentMail = async (options: { inboundText?: string } = {}) => {
  const calls: MailCall[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk as Buffer));
    req.on('end', () => {
      const method = req.method ?? 'GET';
      const { pathname } = new URL(req.url ?? '/', 'http://127.0.0.1');
      const raw = Buffer.concat(chunks).toString('utf8');
      calls.push({ body: raw ? JSON.parse(raw) : undefined, method, path: pathname });

      const json = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };

      if (method === 'POST' && pathname === '/v1/inboxes') {
        return json(200, {
          address: INBOX_ADDRESS,
          clientId: 'cli_mail_1',
          id: INBOX_ID,
          metadata: {},
        });
      }
      if (method === 'POST' && pathname === '/v1/webhooks') {
        return json(200, {
          id: 'wh_mail_1',
          secret: WEBHOOK_SECRET,
          url: 'http://127.0.0.1/hook',
        });
      }
      if (method === 'DELETE' && pathname === `/v1/inboxes/${INBOX_ID}`) {
        res.writeHead(204);
        return res.end();
      }
      if (method === 'POST' && pathname === `/v1/inboxes/${INBOX_ID}/messages`) {
        return json(200, mailDetail({ direction: 'outbound', id: 'msg_out_1', text: '' }));
      }
      if (method === 'GET' && pathname === '/v1/messages/msg_in_1') {
        return json(200, mailDetail({ text: options.inboundText ?? 'the answer' }));
      }
      if (method === 'GET' && pathname === '/v1/messages/msg_in_1/raw') {
        res.writeHead(200, { 'content-type': 'message/rfc822' });
        return res.end(`From: ${HUMAN}\r\nSubject: Hello agent\r\n\r\nbody`);
      }

      return json(404, { error: { message: `unexpected ${method} ${pathname}` } });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return { calls, server, baseUrl: `http://127.0.0.1:${port}` };
};

/** A `message.received` delivery as Agent Mail serializes it. */
const inboundBody = (params: { address?: string; eventId: string; messageId?: string }) =>
  JSON.stringify({
    createdAt: new Date(NOW).toISOString(),
    data: {
      inbox: { address: params.address ?? INBOX_ADDRESS, clientId: 'cli_mail_1', id: INBOX_ID },
      message: { id: params.messageId ?? 'msg_in_1' },
    },
    id: params.eventId,
    type: 'message.received',
  });

/** Sign a delivery exactly as Agent Mail does (`t=<s>,v1=<hmac>` over `t.body`). */
const signedInbound = (params: { body: string; secret?: string }) => ({
  body: params.body,
  headers: {
    'x-agentmail-signature': computeAgentMailSignature(
      params.secret ?? WEBHOOK_SECRET,
      params.body,
      TIMESTAMP,
    ),
  },
});

let mock: Awaited<ReturnType<typeof startMockAgentMail>>;
let gateKeeper: KeyVaultsGateKeeper;
let service: AgentAccountService;

beforeAll(async () => {
  // A real 32-byte AES-GCM key, matching how the deployment builds the
  // gatekeeper, so the credential path is the production one.
  vi.stubEnv('KEY_VAULTS_SECRET', Buffer.alloc(32, 11).toString('base64'));
  gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  mock = await startMockAgentMail({
    inboundText:
      'Yes, ship it.\n\nOn Mon, 1 Jan 2026 at 10:00, Toby <toby@lobe.id> wrote:\n> earlier question\n> and more',
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    mock.server.close((error) => (error ? reject(error) : resolve())),
  );
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  mock.calls.length = 0;
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(agents).values({ id: agentId, userId });

  const registry = new AgentAccountProviderRegistry().register(
    createAgentMailProvider({
      apiBaseUrl: mock.baseUrl,
      apiKey: 'am_mail_chain_e2e',
      now: () => NOW,
      webhookSecret: FALLBACK_SECRET,
      webhookUrl: 'http://127.0.0.1/hook',
    }),
  );

  service = new AgentAccountService(serverDB, userId, { gateKeeper, registry });
});

afterEach(async () => {
  await serverDB.delete(agentAccounts);
  await serverDB.delete(users);
});

describe('Agent Mail chain — end to end over loopback', () => {
  it('provisions, renders markdown to HTML, receives, strips quotes and releases', async () => {
    const transcript: string[] = [];

    // ---------------------------------------------------------------- 1. 开通
    // The provider opens both the inbox and its webhook; the one-time signing
    // secret comes back as the account credential and is encrypted at rest.
    const mail = await service.provision({
      agentId,
      displayName: 'Toby mailbox',
      provider: 'agent-mail',
    });
    transcript.push(
      `1. provision(agent-mail) -> ${mail.identifier} kind=${mail.kind} provider=${mail.provider} ` +
        `capabilities=${JSON.stringify(mail.capabilities)} hasCredential=${mail.hasCredential} ` +
        `hint=${mail.credentialHint?.masked}`,
    );
    expect(mail).toMatchObject({
      capabilities: { receive: true, send: true },
      credentialHint: { masked: '••••cret' },
      hasCredential: true,
      identifier: INBOX_ADDRESS,
      kind: 'mail',
      provider: 'agent-mail',
    });
    // The plaintext secret is never in the column.
    const [row] = await serverDB
      .select({ credentials: agentAccounts.credentials })
      .from(agentAccounts)
      .where(eq(agentAccounts.id, mail.id));
    expect(row.credentials).toBeTruthy();
    expect(row.credentials).not.toContain(WEBHOOK_SECRET);
    expect(mock.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /v1/inboxes',
      'POST /v1/webhooks',
    ]);

    // ------------------------------------------------------- 2. markdown→HTML
    // An agent emits Markdown; email is HTML. The provider renders both an
    // `text/html` part and its `text/plain` alternative, and the assertion is
    // on the bytes that go on the wire — not on a function's return value.
    const markdown = '**Shipped.** See [the docs](https://lobehub.com/docs)\n\n1. one\n2. two';
    const sent = await service.send(mail.id, {
      subject: 'Re: Hello agent',
      text: markdown,
      to: HUMAN,
    });
    const sendCall = mock.calls.find((c) => c.path === `/v1/inboxes/${INBOX_ID}/messages`);
    const wireHtml: string = sendCall?.body?.html;
    const wireText: string = sendCall?.body?.text;
    transcript.push(
      `2. send(mail) -> providerMessageId=${sent.providerMessageId} via ${sendCall?.method} ${sendCall?.path}`,
    );
    transcript.push(`   markdown in  : ${JSON.stringify(markdown)}`);
    transcript.push(`   html out     : ${wireHtml}`);
    transcript.push(`   plain text out: ${JSON.stringify(wireText)}`);
    expect(sent.providerMessageId).toBe('msg_out_1');
    expect(wireHtml).toContain('<strong>Shipped.</strong>');
    expect(wireHtml).toContain('<a href="https://lobehub.com/docs"');
    expect(wireHtml).toContain('<ol><li>one</li><li>two</li></ol>');
    expect(wireHtml).not.toContain('**');
    expect(wireText).toBe('Shipped. See the docs (https://lobehub.com/docs)\n\n- one\n- two');
    expect(wireText).not.toContain('**');

    // ------------------------------------------------ 3+4. 入站验签 + 引用剥离
    const body = inboundBody({ eventId: 'evt_mail_1' });
    const delivered = await service.handleInbound('agent-mail', signedInbound({ body }));
    if (delivered.outcome !== 'delivered')
      throw new Error(`expected delivered, got ${delivered.outcome}`);
    transcript.push(
      `3. handleInbound(signed) -> ${delivered.outcome} from=${delivered.message.from} ` +
        `to=${delivered.message.to} subject=${JSON.stringify(delivered.message.subject)}`,
    );
    expect(delivered.message).toMatchObject({
      from: HUMAN,
      providerMessageId: 'msg_in_1',
      subject: 'Hello agent',
      threadKey: '<root@example.com>',
      to: INBOX_ADDRESS,
    });
    // The quoted history and the "On … wrote:" attribution never reach the
    // agent — only the new line the person actually typed.
    transcript.push(`   inbound text out: ${JSON.stringify(delivered.message.text)}`);
    expect(delivered.message.text).toBe('Yes, ship it.');

    // ---------------------------------------------------- 5. 伪造签名被拒
    const forged = await service.handleInbound('agent-mail', {
      body,
      headers: { 'x-agentmail-signature': 't=1,v1=deadbeef' },
    });
    transcript.push(`5. handleInbound(forged signature) -> ${forged.outcome}`);
    expect(forged.outcome).toBe('rejected');

    // ------------------ 6. 路由按地址：签名有效但不是本账号的收件箱 → 不投递
    const foreignRaw = inboundBody({ address: 'someone-else@lobe.id', eventId: 'evt_mail_2' });
    const foreign = await service.handleInbound(
      'agent-mail',
      signedInbound({ body: foreignRaw, secret: FALLBACK_SECRET }),
    );
    transcript.push(`6. handleInbound(valid signature, foreign inbox) -> ${foreign.outcome}`);
    expect(foreign.outcome).toBe('unknown-account');

    // ---------------------------------------------------------------- 7. 释放
    await service.revoke(mail.id);
    const released = await service.get(mail.id);
    transcript.push(
      `7. revoke(mail) -> status=${released!.status} hasCredential=${released!.hasCredential} ` +
        `inboxReleased=${mock.calls.some((c) => c.method === 'DELETE')}`,
    );
    expect(released).toMatchObject({ hasCredential: false, status: 'revoked' });
    expect(mock.calls).toContainEqual(
      expect.objectContaining({ method: 'DELETE', path: `/v1/inboxes/${INBOX_ID}` }),
    );

    // Sending from a released inbox is refused…
    await expect(
      service.send(mail.id, { subject: 'x', text: 'still there?', to: HUMAN }),
    ).rejects.toThrow(/revoked/);
    transcript.push('8. send(released mail) -> refused (account is revoked)');

    // …and the released inbox stops *receiving* too: the per-inbox secret is
    // gone, so the delivery now falls back to the deployment secret, which
    // still verifies — it is the account status, not a broken signature, that
    // stops the route.
    const afterRelease = await service.handleInbound(
      'agent-mail',
      signedInbound({ body, secret: FALLBACK_SECRET }),
    );
    transcript.push(
      `9. handleInbound(valid deployment signature, released inbox) -> ${afterRelease.outcome} (no longer routed)`,
    );
    expect(afterRelease.outcome).toBe('unknown-account');

    transcript.push(`wire: ${mock.calls.map((c) => `${c.method} ${c.path}`).join(' | ')}`);
    console.log(`\n[mail-chain]\n${transcript.join('\n')}\n[/mail-chain]\n`);
  });
});
