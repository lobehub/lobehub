// @vitest-environment node
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { computeAgentMailSignature } from '@lobechat/agent-address-mail';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentAccounts, agentInboxMessages, agents, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import type * as AgentIdentityProviders from '../providers';

/**
 * End-to-end evidence run for the inbound edge.
 *
 * Drives the **real Hono route** (`POST /api/agent/accounts/webhooks/:provider`)
 * through `app.request(...)`: real raw-body handling, the real provider-signature
 * verification path inside `AgentAccountService`, the real Drizzle model on
 * PGlite (so the `agent_inbox_messages` row is a real row), and the real waker.
 *
 * Only two things are faked, and both are named:
 *  - the Agent Mail **SaaS** behind provisioning (a loopback server, because the
 *    lobe.id tenant key is an operations prerequisite this environment lacks);
 *  - `AiAgentService`, whose `execAgent` would otherwise call an LLM. The waker
 *    itself is real — the fake records the call the waker makes, which is what
 *    proves the wake is stamped `trigger: inbox` on the account's owner.
 */

const holder = vi.hoisted(() => ({ db: undefined as unknown as LobeChatDatabase }));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => holder.db,
}));

const agentCalls = vi.hoisted(() => [] as Array<{ execAgent: any; userId: string }>);
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: class {
    private readonly userId: string;
    constructor(_db: unknown, userId: string) {
      this.userId = userId;
    }
    async execAgent(params: unknown) {
      agentCalls.push({ execAgent: params, userId: this.userId });
      return {
        agentId: 'agent-inbound-chain',
        assistantMessageId: 'msg_assistant_inbox',
        autoStarted: true,
        createdAt: new Date().toISOString(),
        operationId: 'op_inbox_1',
      };
    }
  },
}));

let mockBaseUrl = '';

// The route's factory builds its registry from deployment env, which this
// environment has not configured. Point `createDefaultAgentAccountRegistry` at
// a fixture Agent Mail provider so the route resolves `agent-mail`; signature
// verification still uses the account's own stored secret, so nothing here
// weakens the trust path.
vi.mock('../providers', async (importOriginal) => {
  const actual = await importOriginal<typeof AgentIdentityProviders>();
  return {
    ...actual,
    createDefaultAgentAccountRegistry: () =>
      actual.createAgentAccountRegistry({
        agentMail: { apiBaseUrl: mockBaseUrl, apiKey: 'am_route_test' },
      }),
  };
});

const { default: agentApp } = await import('@/server/router-hono/agent');

const serverDB: LobeChatDatabase = await getTestDB();
holder.db = serverDB;

const userId = 'agent-inbound-chain-user';
const agentId = 'agent-inbound-chain';
const WEBHOOK_SECRET = 'whsec_inbound_chain';

const inboundBody = (overrides: { address?: string; messageId?: string; eventId?: string } = {}) =>
  JSON.stringify({
    createdAt: '2026-10-02T12:00:00.000Z',
    data: {
      inbox: {
        address: overrides.address ?? 'toby-agent@lobe.id',
        clientId: 'cli_chain',
        id: 'inb_chain',
      },
      message: { id: overrides.messageId ?? 'msg_in_chain' },
    },
    id: overrides.eventId ?? 'evt_chain_1',
    type: 'message.received',
  });

const mailDetail = (text: string) => ({
  attachments: [],
  bcc: [],
  cc: [],
  codes: [],
  direction: 'inbound' as const,
  envelope: { from: 'login@service.com', to: 'toby-agent@lobe.id' },
  error: null,
  from: { address: 'login@service.com', name: 'Service' },
  html: null,
  id: 'msg_in_chain',
  inboxId: 'inb_chain',
  inReplyTo: null,
  links: [],
  messageId: '<m-chain@example.com>',
  read: false,
  receivedAt: '2026-10-02T12:00:00.000Z',
  references: [],
  replyTo: [],
  size: 64,
  snippet: null,
  status: 'received',
  subject: 'Your verification code',
  text,
  to: [{ address: 'toby-agent@lobe.id' }],
});

let mockServer: ReturnType<typeof createServer>;
let accountId = '';

beforeAll(async () => {
  vi.stubEnv('KEY_VAULTS_SECRET', Buffer.alloc(32, 9).toString('base64'));

  mockServer = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk as Buffer));
    req.on('end', () => {
      const method = req.method ?? 'GET';
      const { pathname } = new URL(req.url ?? '/', 'http://127.0.0.1');
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };

      if (method === 'POST' && pathname === '/v1/inboxes')
        return json(200, { address: 'toby-agent@lobe.id', clientId: 'cli_chain', id: 'inb_chain' });
      if (method === 'POST' && pathname === '/v1/webhooks')
        return json(200, { id: 'wh_chain', secret: WEBHOOK_SECRET, url: 'http://127.0.0.1/hook' });
      if (method === 'GET' && pathname === '/v1/messages/msg_in_chain')
        return json(200, mailDetail('Your verification code is 839201. It expires in 10 minutes.'));
      if (method === 'GET' && pathname === '/v1/messages/msg_in_chain/raw') {
        res.writeHead(200, { 'content-type': 'message/rfc822' });
        return res.end('From: login@service.com\r\nSubject: Your verification code\r\n\r\nx');
      }
      return json(404, { error: { message: `unexpected ${method} ${pathname}` } });
    });
  });

  await new Promise<void>((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  mockBaseUrl = `http://127.0.0.1:${(mockServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    mockServer.close((error) => (error ? reject(error) : resolve())),
  );
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  agentCalls.length = 0;
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(agents).values({ id: agentId, userId });

  // Provision a real mail account over the loopback Agent Mail.
  const { AgentAccountService } = await import('../index');
  const { createAgentMailProvider } = await import('../providers/agentMail');
  const { AgentAccountProviderRegistry } = await import('../registry');
  const { KeyVaultsGateKeeper } = await import('@/server/modules/KeyVaultsEncrypt');

  const registry = new AgentAccountProviderRegistry().register(
    createAgentMailProvider({
      apiBaseUrl: mockBaseUrl,
      apiKey: 'am_route_test',
      webhookUrl: 'http://127.0.0.1/hook',
    }),
  );
  const service = new AgentAccountService(serverDB, userId, {
    gateKeeper: await KeyVaultsGateKeeper.initWithEnvKey(),
    registry,
  });

  const account = await service.provision({ agentId, provider: 'agent-mail' });
  accountId = account.id;
});

afterEach(async () => {
  await serverDB.delete(agentInboxMessages);
  await serverDB.delete(agentAccounts);
  await serverDB.delete(users);
});

const signedHeaders = (body: string) => ({
  'content-type': 'application/json',
  'x-agentmail-signature': computeAgentMailSignature(
    WEBHOOK_SECRET,
    body,
    Math.floor(Date.now() / 1000),
  ),
});

const post = (provider: string, body: string, headers: Record<string, string>) =>
  agentApp.request(`/api/agent/accounts/webhooks/${provider}`, {
    body,
    headers,
    method: 'POST',
  });

describe('Agent inbound webhook — end to end over the real route', () => {
  it('delivers a signed inbound into the inbox and wakes the agent exactly once', async () => {
    const transcript: string[] = [];
    const body = inboundBody();

    // 1. A signed delivery lands: 200, one inbox row, one wake.
    const first = await post('agent-mail', body, signedHeaders(body));
    const firstJson = await first.json();
    transcript.push(
      `1. POST /accounts/webhooks/agent-mail (signed) -> ${first.status} created=${firstJson.created} messageId=${firstJson.messageId} wake=${firstJson.wake?.reason}`,
    );
    expect(first.status).toBe(200);
    expect(firstJson).toMatchObject({ created: true, outcome: 'delivered', success: true });

    const rows = await serverDB
      .select()
      .from(agentInboxMessages)
      .where(eq(agentInboxMessages.accountId, accountId));
    expect(rows).toHaveLength(1);
    transcript.push(
      `2. agent_inbox_messages -> ${rows.length} row(s) from=${rows[0].from} subject=${JSON.stringify(rows[0].subject)} codes=${JSON.stringify(rows[0].codes)} readAt=${rows[0].readAt}`,
    );
    expect(rows[0]).toMatchObject({
      agentId,
      codes: ['839201'],
      from: 'login@service.com',
      kind: 'mail',
      provider: 'agent-mail',
      providerMessageId: 'msg_in_chain',
      subject: 'Your verification code',
    });
    expect(rows[0].readAt).toBeNull();

    // 3. The wake is a real run on the account's owner, stamped `inbox`.
    expect(agentCalls).toHaveLength(1);
    transcript.push(
      `3. AiAgentService.execAgent -> userId=${agentCalls[0].userId} agentId=${agentCalls[0].execAgent.agentId} trigger=${agentCalls[0].execAgent.trigger}`,
    );
    expect(agentCalls[0].userId).toBe(userId);
    expect(agentCalls[0].execAgent).toMatchObject({ agentId, trigger: 'inbox' });

    // 4. The provider retries the SAME delivery: idempotent, no second wake.
    const retry = await post('agent-mail', body, signedHeaders(body));
    const retryJson = await retry.json();
    transcript.push(
      `4. retry same delivery -> ${retry.status} created=${retryJson.created} wake=${retryJson.wake?.reason} execAgentCalls=${agentCalls.length}`,
    );
    expect(retry.status).toBe(200);
    expect(retryJson).toMatchObject({ created: false, messageId: firstJson.messageId });
    expect(agentCalls).toHaveLength(1);

    const afterRetry = await serverDB
      .select()
      .from(agentInboxMessages)
      .where(eq(agentInboxMessages.accountId, accountId));
    expect(afterRetry).toHaveLength(1);

    // 5. A forged signature is refused and stores nothing.
    const forged = await post('agent-mail', body, {
      'content-type': 'application/json',
      'x-agentmail-signature': 't=1,v1=deadbeef',
    });
    const forgedJson = await forged.json();
    transcript.push(`5. POST (forged signature) -> ${forged.status} outcome=${forgedJson.outcome}`);
    expect(forged.status).toBe(401);
    expect(agentCalls).toHaveLength(1);

    // 6. A provider this deployment does not run is a 404, not a 500.
    const unknownProvider = await post('nope-mail', body, signedHeaders(body));
    transcript.push(`6. POST (unknown provider) -> ${unknownProvider.status}`);
    expect(unknownProvider.status).toBe(404);

    // 7. A signed delivery for an address with no account cannot be routed.
    const unroutedBody = inboundBody({ address: 'nobody@lobe.id', messageId: 'msg_other' });
    const unrouted = await post('agent-mail', unroutedBody, signedHeaders(unroutedBody));
    const unroutedJson = await unrouted.json();
    transcript.push(
      `7. POST (signed, unrouted address) -> ${unrouted.status} outcome=${unroutedJson.outcome}`,
    );
    expect(unrouted.status).toBe(404);

    console.log(`\n[agent-inbound-chain]\n${transcript.join('\n')}\n[/agent-inbound-chain]\n`);
  });

  it('records the newest delivery and reports an unread inbox summary', async () => {
    const body = inboundBody();
    await post('agent-mail', body, signedHeaders(body));

    const { AgentInboxService } = await import('../inbox');
    const summary = await AgentInboxService.summary(serverDB, agentId, 3);

    expect(summary.unreadCount).toBe(1);
    expect(summary.latest).toHaveLength(1);
    expect(summary.latest[0]).toMatchObject({ codes: ['839201'], from: 'login@service.com' });
  });
});
