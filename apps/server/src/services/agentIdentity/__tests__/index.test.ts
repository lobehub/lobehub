// @vitest-environment node
import type { EmailMessageDetail } from '@lobechat/agent-address-mail';
import { computeAgentMailSignature } from '@lobechat/agent-address-mail';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentAccounts, agents, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { AgentAccountService } from '../index';
import { createAgentMailProvider } from '../providers/agentMail';
import { AgentAccountProviderRegistry } from '../registry';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-identity-service-user';
const agentId = 'agent-identity-service-agent';
const WEBHOOK_SECRET = 'whsec_svc_secret';

const gateKeeper = {
  decrypt: vi.fn(async (ciphertext: string) => ({ plaintext: ciphertext })),
  encrypt: vi.fn(async (plaintext: string) => plaintext),
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, status });

const mailDetail = (overrides: Partial<EmailMessageDetail> = {}): EmailMessageDetail => ({
  attachments: [],
  bcc: [],
  cc: [],
  codes: [],
  direction: 'inbound',
  envelope: { from: 'human@example.com', to: 'agent-7@lobe.id' },
  error: null,
  from: { address: 'human@example.com', name: 'Human' },
  html: null,
  id: 'msg_in_1',
  inboxId: 'inb_1',
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
  subject: 'Hello',
  text: 'the answer',
  to: [{ address: 'agent-7@lobe.id' }],
  ...overrides,
});

const createMailFetch = () => {
  const calls: Array<{ method: string; path: string }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    const { pathname } = new URL(url);
    const method = init?.method ?? 'GET';
    calls.push({ method, path: pathname });

    if (method === 'POST' && pathname === '/v1/inboxes') {
      return json({ address: 'agent-7@lobe.id', clientId: 'cli_1', id: 'inb_1', metadata: {} });
    }
    if (method === 'POST' && pathname === '/v1/webhooks') {
      return json({ id: 'wh_1', secret: WEBHOOK_SECRET, url: 'https://app.lobehub.com/hook' });
    }
    if (method === 'DELETE' && pathname === '/v1/inboxes/inb_1') {
      return new Response(null, { status: 204 });
    }
    if (method === 'POST' && pathname === '/v1/inboxes/inb_1/messages') {
      return json(mailDetail({ direction: 'outbound', id: 'msg_out_1' }));
    }
    if (method === 'GET' && pathname === '/v1/messages/msg_in_1') return json(mailDetail());
    if (method === 'GET' && pathname === '/v1/messages/msg_in_1/raw') {
      return new Response('From: human@example.com\r\nSubject: Hello\r\n\r\nbody');
    }
    throw new Error(`unexpected mail request ${method} ${pathname}`);
  };

  return { calls, fetchImpl };
};

const buildService = (fetchImpl: typeof fetch) => {
  const registry = new AgentAccountProviderRegistry().register(
    createAgentMailProvider({
      apiKey: 'am_svc',
      fetchImpl,
      webhookUrl: 'https://app.lobehub.com/hook',
    }),
  );

  return new AgentAccountService(serverDB, userId, { gateKeeper, registry });
};

const inboundBody = (address = 'agent-7@lobe.id') =>
  JSON.stringify({
    createdAt: '2026-10-02T00:00:00.000Z',
    data: { inbox: { address, clientId: 'cli_1', id: 'inb_1' }, message: { id: 'msg_in_1' } },
    id: 'evt_1',
    type: 'message.received',
  });

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(agents).values({ id: agentId, userId });
});

afterEach(async () => {
  await serverDB.delete(agentAccounts);
  await serverDB.delete(users);
  vi.clearAllMocks();
});

describe('AgentAccountService — provisioning', () => {
  it('persists the provider-declared kind and capabilities, and keeps the secret out of reads', async () => {
    const { fetchImpl } = createMailFetch();
    const service = buildService(fetchImpl);

    const created = await service.provision({ agentId, provider: 'agent-mail' });

    expect(created).toMatchObject({
      agentId,
      capabilities: { receive: true, send: true },
      hasCredential: true,
      identifier: 'agent-7@lobe.id',
      kind: 'mail',
      provider: 'agent-mail',
      // Opened synchronously, so the persisted row is live — the settings page
      // must not show a usable address as still "opening".
      status: 'active',
    });
    expect(created).not.toHaveProperty('credentials');
    expect(created.metadata).toEqual({ clientId: 'cli_1', inboxId: 'inb_1' });

    const listed = await service.list({ agentId });
    expect(listed).toHaveLength(1);
    expect(listed[0]).not.toHaveProperty('credentials');

    const found = await service.get(created.id);
    expect(found).not.toHaveProperty('credentials');
  });

  it('refuses an unregistered provider unless capabilities are stated', async () => {
    const service = buildService(createMailFetch().fetchImpl);

    await expect(
      service.create({
        agentId,
        identifier: 'agent@github',
        kind: 'service',
        provider: 'user',
      }),
    ).rejects.toThrow(/capabilities cannot be inferred/);

    const created = await service.create({
      agentId,
      capabilities: { login: true, receive: false, send: false },
      credential: { password: 'hunter2' },
      identifier: 'agent@github',
      kind: 'service',
      provider: 'user',
    });
    expect(created).toMatchObject({ kind: 'service', provider: 'user' });
    expect(created.capabilities).toEqual({ login: true, receive: false, send: false });
  });

  it('surfaces the registry error for a provider the deployment does not run', async () => {
    const service = buildService(createMailFetch().fetchImpl);

    await expect(service.provision({ agentId, provider: 'linq' })).rejects.toThrow(
      /Unknown agent account provider "linq"/,
    );
  });
});

describe('AgentAccountService — actions', () => {
  it('sends through the account provider', async () => {
    const { fetchImpl } = createMailFetch();
    const service = buildService(fetchImpl);
    const created = await service.provision({ agentId, provider: 'agent-mail' });

    await expect(
      service.send(created.id, { subject: 'Re: Hello', text: 'hi back', to: 'human@example.com' }),
    ).resolves.toEqual({ providerMessageId: 'msg_out_1' });
  });

  it('refuses to send from a revoked account', async () => {
    const { fetchImpl } = createMailFetch();
    const service = buildService(fetchImpl);
    const created = await service.provision({ agentId, provider: 'agent-mail' });

    await service.revoke(created.id);

    await expect(service.send(created.id, { text: 'hi', to: 'human@example.com' })).rejects.toThrow(
      /revoked/,
    );
  });

  it('releases on the provider and purges the credential when revoking', async () => {
    const { calls, fetchImpl } = createMailFetch();
    const service = buildService(fetchImpl);
    const created = await service.provision({ agentId, provider: 'agent-mail' });

    await service.revoke(created.id);

    expect(calls).toContainEqual({ method: 'DELETE', path: '/v1/inboxes/inb_1' });
    const revoked = await service.get(created.id);
    expect(revoked).toMatchObject({ hasCredential: false, status: 'revoked' });
    expect(revoked!.revokedAt).toBeTruthy();
  });
});

describe('AgentAccountService — inbound routing', () => {
  it('resolves the account, verifies the signature and normalizes the message', async () => {
    const { fetchImpl } = createMailFetch();
    const service = buildService(fetchImpl);
    const created = await service.provision({ agentId, provider: 'agent-mail' });

    const body = inboundBody();
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

    expect(outcome.outcome).toBe('delivered');
    if (outcome.outcome !== 'delivered') throw new Error('unreachable');
    expect(outcome.accountId).toBe(created.id);
    expect(outcome.message).toMatchObject({
      from: 'human@example.com',
      providerMessageId: 'msg_in_1',
      to: 'agent-7@lobe.id',
    });
  });

  it('rejects a delivery whose signature does not verify', async () => {
    const { fetchImpl } = createMailFetch();
    const service = buildService(fetchImpl);
    await service.provision({ agentId, provider: 'agent-mail' });

    const outcome = await service.handleInbound('agent-mail', {
      body: inboundBody(),
      headers: { 'x-agentmail-signature': 't=1,v1=deadbeef' },
    });

    expect(outcome.outcome).toBe('rejected');
  });

  it('reports an unmapped address as an unknown account', async () => {
    const { fetchImpl } = createMailFetch();
    const service = buildService(fetchImpl);
    await service.provision({ agentId, provider: 'agent-mail' });

    const outcome = await service.handleInbound('agent-mail', {
      body: inboundBody('nobody@lobe.id'),
      headers: {},
    });

    expect(outcome.outcome).toBe('unknown-account');
  });
});
