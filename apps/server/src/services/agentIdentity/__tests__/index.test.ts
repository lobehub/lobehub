// @vitest-environment node
import type { EmailMessageDetail } from '@lobechat/agent-address-mail';
import { computeAgentMailSignature } from '@lobechat/agent-address-mail';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentAccounts, agents, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { AgentAccountService } from '../index';
import { createAgentMailProvider } from '../providers/agentMail';
import { createLinqProvider } from '../providers/linq';
import { AgentAccountProviderRegistry } from '../registry';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-identity-service-user';
const agentId = 'agent-identity-service-agent';
const otherAgentId = 'agent-identity-service-agent-2';
const foreignUserId = 'agent-identity-service-user-2';
const foreignAgentId = 'agent-identity-service-agent-3';
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

const inboundBody = (address = 'agent-7@lobe.id', eventId = 'evt_1') =>
  JSON.stringify({
    createdAt: '2026-10-02T00:00:00.000Z',
    data: { inbox: { address, clientId: 'cli_1', id: 'inb_1' }, message: { id: 'msg_in_1' } },
    id: eventId,
    type: 'message.received',
  });

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(agents).values([
    { id: agentId, userId },
    { id: otherAgentId, userId },
  ]);
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
    expect(created).toMatchObject({ kind: 'service', provider: 'user', status: 'active' });
    expect(created.capabilities).toEqual({ login: true, receive: false, send: false });
  });

  it('refuses to open an account on an agent the caller does not own', async () => {
    const { calls, fetchImpl } = createMailFetch();
    const service = buildService(fetchImpl);

    await serverDB.insert(users).values({ id: foreignUserId });
    await serverDB.insert(agents).values({ id: foreignAgentId, userId: foreignUserId });

    // Being able to see or use a shared agent is not enough: an account binds
    // an address *and a credential* to it, which only its creator may do.
    await expect(
      service.provision({ agentId: foreignAgentId, provider: 'agent-mail' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // Refused before the provider ran, so no remote inbox was created at all.
    expect(calls).toEqual([]);
    expect(await service.list()).toHaveLength(0);

    await expect(
      service.create({
        agentId: foreignAgentId,
        capabilities: { receive: false, send: false },
        identifier: 'agent@github',
        kind: 'service',
        provider: 'user',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(await service.list()).toHaveLength(0);
  });

  it('releases the issued inbox and refuses readably when the row cannot be written', async () => {
    const { calls, fetchImpl } = createMailFetch();
    const service = buildService(fetchImpl);
    await service.provision({ agentId, provider: 'agent-mail' });

    // The mock hands out the same address again, so the second insert collides
    // on the routing key after the provider already opened an inbox.
    await expect(
      service.provision({ agentId: otherAgentId, provider: 'agent-mail' }),
    ).rejects.toMatchObject({
      code: 'identifier_taken',
      message: expect.stringMatching(/already bound to another agent/),
    });

    expect(calls.filter((c) => c.method === 'DELETE')).toEqual([
      { method: 'DELETE', path: '/v1/inboxes/inb_1' },
    ]);
    expect(await service.list()).toHaveLength(1);
  });

  it('keeps the inbox and returns the account when the insert committed but its ack was lost', async () => {
    const { calls, fetchImpl } = createMailFetch();
    const service = buildService(fetchImpl);
    const model = (service as any).model;
    const create = model.create;
    model.create = async (...args: unknown[]) => {
      await create(...args);
      throw new Error('Connection terminated unexpectedly');
    };

    const account = await service.provision({ agentId, provider: 'agent-mail' });

    expect(account).toMatchObject({ agentId, identifier: 'agent-7@lobe.id' });
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect(await service.list()).toHaveLength(1);
  });

  it('still releases the inbox when a failed write left no row behind', async () => {
    const { calls, fetchImpl } = createMailFetch();
    const service = buildService(fetchImpl);
    (service as any).model.create = async () => {
      throw new Error('Connection refused');
    };

    await expect(service.provision({ agentId, provider: 'agent-mail' })).rejects.toThrow(
      /Connection refused/,
    );
    expect(calls).toContainEqual({ method: 'DELETE', path: '/v1/inboxes/inb_1' });
  });

  it('lets a released handle be bound again', async () => {
    const service = buildService(createMailFetch().fetchImpl);
    const first = await service.provision({ agentId, provider: 'agent-mail' });
    await service.revoke(first.id);

    const second = await service.provision({ agentId, provider: 'agent-mail' });

    expect(second.identifier).toBe('agent-7@lobe.id');
    expect(second.status).not.toBe('revoked');
    expect(second.id).not.toBe(first.id);
  });

  it('hands out one pool number per live phone account', async () => {
    const registry = new AgentAccountProviderRegistry().register(
      createLinqProvider({ apiKey: 'linq_svc', fromNumbers: ['+15550002222'] }),
    );
    const service = new AgentAccountService(serverDB, userId, { gateKeeper, registry });

    const first = await service.provision({ agentId, provider: 'linq' });
    expect(first.identifier).toBe('+15550002222');

    await expect(
      service.provision({ agentId: otherAgentId, provider: 'linq' }),
    ).rejects.toMatchObject({ code: 'capacity_exhausted' });

    await service.revoke(first.id);
    await expect(
      service.provision({ agentId: otherAgentId, provider: 'linq' }),
    ).resolves.toMatchObject({ agentId: otherAgentId, identifier: '+15550002222' });
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

  it('refuses to send from a suspended account', async () => {
    const { calls, fetchImpl } = createMailFetch();
    const service = buildService(fetchImpl);
    const created = await service.provision({ agentId, provider: 'agent-mail' });

    await serverDB
      .update(agentAccounts)
      .set({ status: 'suspended' })
      .where(eq(agentAccounts.id, created.id));

    await expect(service.send(created.id, { text: 'hi', to: 'human@example.com' })).rejects.toThrow(
      /suspended/,
    );
    expect(calls.some((call) => call.method === 'POST' && call.path.includes('/messages'))).toBe(
      false,
    );
  });

  it('refuses to send from an account whose persisted capabilities exclude sending', async () => {
    const { calls, fetchImpl } = createMailFetch();
    const service = buildService(fetchImpl);
    const created = await service.provision({ agentId, provider: 'agent-mail' });

    await serverDB
      .update(agentAccounts)
      .set({ capabilities: { receive: true, send: false } })
      .where(eq(agentAccounts.id, created.id));

    await expect(service.send(created.id, { text: 'hi', to: 'human@example.com' })).rejects.toThrow(
      /not allowed to send/,
    );
    expect(calls.some((call) => call.method === 'POST' && call.path.includes('/messages'))).toBe(
      false,
    );
  });

  it('refuses to move an account through the generic patch', async () => {
    const service = buildService(createMailFetch().fetchImpl);
    const created = await service.provision({ agentId, provider: 'agent-mail' });

    // Lifecycle must go through `revoke`, which also releases the provider
    // resource, purges the credential and stamps `revokedAt` — writing the
    // status directly would free the handle while skipping all of that.
    const lifecyclePatch = { status: 'revoked' } as unknown as Parameters<typeof service.update>[1];

    await expect(service.update(created.id, lifecyclePatch)).rejects.toThrow(/not patchable/);

    expect(await service.get(created.id)).toMatchObject({ status: 'active' });
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

  it('does not route a delivery to a suspended account', async () => {
    const { fetchImpl } = createMailFetch();
    const service = buildService(fetchImpl);
    const created = await service.provision({ agentId, provider: 'agent-mail' });

    await serverDB
      .update(agentAccounts)
      .set({ status: 'suspended' })
      .where(eq(agentAccounts.id, created.id));

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

    expect(outcome.outcome).toBe('unknown-account');
  });

  it('acknowledges but does not deliver to an account that cannot receive', async () => {
    const { calls, fetchImpl } = createMailFetch();
    const service = buildService(fetchImpl);
    const created = await service.provision({ agentId, provider: 'agent-mail' });

    await serverDB
      .update(agentAccounts)
      .set({ capabilities: { receive: false, send: true } })
      .where(eq(agentAccounts.id, created.id));

    // A fresh event id: the default replay store outlives a single test.
    const body = inboundBody(undefined, 'evt_receive_disabled');
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

    expect(outcome).toEqual({ accountId: created.id, outcome: 'ignored' });
    expect(
      calls.some((call) => call.method === 'GET' && call.path.startsWith('/v1/messages')),
    ).toBe(false);
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
