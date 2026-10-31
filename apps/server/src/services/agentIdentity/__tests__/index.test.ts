// @vitest-environment node
import type { EmailMessageDetail } from '@lobechat/agent-address-mail';
import { computeAgentMailSignature } from '@lobechat/agent-address-mail';
import { getTestDB } from '@lobechat/database/test-utils';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentAccounts, agents, users, workspaces } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { AgentAccountService } from '../index';
import { createAgentMailProvider } from '../providers/agentMail';
import { createLinqProvider } from '../providers/linq';
import { AgentAccountProviderRegistry } from '../registry';

// The agent's edit ACL is its own suite's subject; here it is the seam whose
// verdict the service must honor, admitting exactly whom the ACL admits.
const { assertCanEditResource, assertCanPerformResourceAction } = vi.hoisted(() => ({
  assertCanEditResource: vi.fn(async (_params: { userId: string; workspaceId?: string }) => {}),
  assertCanPerformResourceAction: vi.fn(async (_params: { userId: string }) => {}),
}));
vi.mock('@/server/services/resourcePermission', () => ({
  assertCanEditResource,
  assertCanPerformResourceAction,
}));

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
  assertCanEditResource.mockReset();
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
    ).rejects.toMatchObject({ code: 'capabilities_required', reason: 'invalid' });

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

  it('refuses to mount a handle on a provider the deployment runs, before writing anything', async () => {
    const { calls, fetchImpl } = createMailFetch();
    const service = buildService(fetchImpl);

    // Mounting would persist an inbox the caller merely names; revoke would then
    // delete it, and send would speak as it, with the deployment-wide key.
    await expect(
      service.create({
        agentId,
        capabilities: { receive: true, send: true },
        identifier: 'someone-else@lobe.id',
        kind: 'mail',
        metadata: { inboxId: 'inb_someone_else' },
        provider: 'agent-mail',
      }),
    ).rejects.toMatchObject({ code: 'provider_managed', reason: 'invalid' });

    expect(await service.list()).toHaveLength(0);
    expect(calls).toEqual([]);
  });

  it('keeps a reserved provider name unmountable while its key is absent', async () => {
    // A deployment without the Agent Mail key does not register the provider.
    // That omission must not make its handles mountable: the row would speak
    // and delete with the deployment-wide key once the key is restored.
    const service = new AgentAccountService(serverDB, userId, {
      gateKeeper,
      registry: new AgentAccountProviderRegistry(),
    });

    await expect(
      service.create({
        agentId,
        capabilities: { receive: true, send: true },
        identifier: 'someone-else@lobe.id',
        kind: 'mail',
        metadata: { inboxId: 'inb_someone_else' },
        provider: 'agent-mail',
      }),
    ).rejects.toMatchObject({ code: 'provider_managed', reason: 'invalid' });

    expect(await service.list()).toHaveLength(0);
  });

  it('refuses to open an account on an agent the caller does not own', async () => {
    const { calls, fetchImpl } = createMailFetch();
    const service = buildService(fetchImpl);

    await serverDB.insert(users).values({ id: foreignUserId });
    await serverDB.insert(agents).values({ id: foreignAgentId, userId: foreignUserId });

    // An agent the caller cannot see answers like a missing one, so the refusal
    // never confirms that a colleague's private agent exists.
    await expect(
      service.provision({ agentId: foreignAgentId, provider: 'agent-mail' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

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
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

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

  it('keeps the live inbox when a retry collides on its own routing key', async () => {
    const { calls, fetchImpl } = createMailFetch();
    const service = buildService(fetchImpl);
    const first = await service.provision({ agentId, provider: 'agent-mail' });

    // `provision` is idempotent by contract, so a retry can be handed the inbox
    // that already backs the live row; the insert then collides on the routing
    // key. That collision is *this* account, not a rival: releasing here would
    // delete the inbox the live account is using.
    const retry = await service.provision({ agentId, provider: 'agent-mail' });

    expect(retry.id).toBe(first.id);
    expect(retry.identifier).toBe('agent-7@lobe.id');
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect(await service.list()).toHaveLength(1);
  });

  it('reconciles a rebind against the live row, not the revoked one it replaced', async () => {
    const { calls, fetchImpl } = createMailFetch();
    const service = buildService(fetchImpl);
    const first = await service.provision({ agentId, provider: 'agent-mail' });
    await service.revoke(first.id);

    // A released handle can be bound again, so the key now carries both the
    // revoked row and the account that replaced it. A retry that collides has to
    // read the live one; reading the replaced row would release its inbox.
    const live = await service.provision({ agentId, provider: 'agent-mail' });
    const deletesBeforeRetry = calls.filter((c) => c.method === 'DELETE').length;

    const retry = await service.provision({ agentId, provider: 'agent-mail' });

    expect(retry.id).toBe(live.id);
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(deletesBeforeRetry);
    expect(await service.list()).toHaveLength(2);
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

  it('refuses to rewrite the provider-owned handles of an issued account', async () => {
    const { calls, fetchImpl } = createMailFetch();
    const service = buildService(fetchImpl);
    const created = await service.provision({ agentId, provider: 'agent-mail' });

    // Send and release act on `metadata.inboxId` with the deployment-wide key,
    // so a patched id would let the account send as, or delete, another inbox.
    await expect(
      service.update(created.id, { metadata: { inboxId: 'inb_someone_else' } }),
    ).rejects.toMatchObject({ code: 'provider_owned_field', reason: 'invalid' });
    expect(await service.get(created.id)).toMatchObject({
      metadata: { clientId: 'cli_1', inboxId: 'inb_1' },
    });

    await service.revoke(created.id);
    expect(calls).toContainEqual({ method: 'DELETE', path: '/v1/inboxes/inb_1' });

    // A caller-mounted account of an unregistered provider still owns its metadata.
    const mounted = await service.create({
      agentId,
      capabilities: { login: true, receive: false, send: false },
      identifier: 'agent@github',
      kind: 'service',
      provider: 'user',
    });
    await expect(service.update(mounted.id, { metadata: { org: 'lobehub' } })).resolves.toBe(
      mounted.id,
    );
  });

  it('admits exactly the members the agent edit ACL admits, for every write', async () => {
    const workspaceId = 'agent-identity-service-ws';
    const editorId = 'agent-identity-service-editor';
    await serverDB.insert(users).values([{ id: foreignUserId }, { id: editorId }]);
    const sharedAgentId = 'agent-identity-service-shared-agent';
    await serverDB
      .insert(workspaces)
      .values({ id: workspaceId, name: workspaceId, primaryOwnerId: userId, slug: workspaceId });
    await serverDB
      .insert(agents)
      .values({ id: sharedAgentId, userId, visibility: 'public', workspaceId });
    // The member may use the shared agent but holds no edit level on it; the
    // editor is a collaborator with an edit grant, though not its creator.
    assertCanEditResource.mockImplementation(async (params) => {
      if (params.userId === foreignUserId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'no edit' });
      }
    });

    const { calls, fetchImpl } = createMailFetch();
    const registry = new AgentAccountProviderRegistry().register(
      createAgentMailProvider({ apiKey: 'am_svc', fetchImpl, webhookUrl: 'https://x/hook' }),
    );
    const serviceFor = (id: string) =>
      new AgentAccountService(serverDB, id, { gateKeeper, registry, workspaceId });
    const member = serviceFor(foreignUserId);
    const editor = serviceFor(editorId);

    await expect(
      member.provision({ agentId: sharedAgentId, provider: 'agent-mail' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(calls).toEqual([]);

    // The transports admit an edit-level collaborator, so the service must not
    // refuse them a second time on a creator-only rule.
    const created = await editor.provision({ agentId: sharedAgentId, provider: 'agent-mail' });
    expect(assertCanEditResource).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: sharedAgentId, resourceType: 'agent', workspaceId }),
    );

    // The workspace scope lets the member see the account; that is not enough
    // to replace its secret, rewrite it or release its inbox.
    expect(await member.get(created.id)).toBeDefined();
    await expect(member.setCredential(created.id, { webhookSecret: 'x' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(member.update(created.id, { displayName: 'mine' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(member.revoke(created.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);

    await expect(editor.update(created.id, { displayName: 'Ops inbox' })).resolves.toBe(created.id);
    expect(await editor.get(created.id)).toMatchObject({ displayName: 'Ops inbox' });

    await serverDB.delete(agentAccounts);
    await serverDB.delete(agents).where(eq(agents.id, sharedAgentId));
    await serverDB.delete(workspaces);
  });

  it('refuses to send through an agent the member may not use', async () => {
    const workspaceId = 'agent-identity-service-use-ws';
    const memberId = 'agent-identity-service-use-member';
    const useAgentId = 'agent-identity-service-use-agent';
    await serverDB.insert(users).values([{ id: memberId }]);
    await serverDB
      .insert(workspaces)
      .values({ id: workspaceId, name: workspaceId, primaryOwnerId: userId, slug: workspaceId });
    await serverDB
      .insert(agents)
      .values({ id: useAgentId, userId, visibility: 'public', workspaceId });

    const { calls, fetchImpl } = createMailFetch();
    const registry = new AgentAccountProviderRegistry().register(
      createAgentMailProvider({ apiKey: 'am_svc', fetchImpl, webhookUrl: 'https://x/hook' }),
    );
    const serviceFor = (id: string) =>
      new AgentAccountService(serverDB, id, { gateKeeper, registry, workspaceId });

    const created = await serviceFor(userId).provision({
      agentId: useAgentId,
      provider: 'agent-mail',
    });
    const sent = () => calls.filter((c) => c.method === 'POST' && c.path.includes('/messages'));
    const member = serviceFor(memberId);

    // The account row is workspace-scoped, so the member can read it. Acting
    // through it is a *use* of the parent agent, which this member lacks.
    expect(await member.get(created.id)).toBeDefined();
    assertCanPerformResourceAction.mockImplementation(async (params: { userId: string }) => {
      if (params.userId === memberId) throw new TRPCError({ code: 'FORBIDDEN', message: 'no use' });
    });

    await expect(
      member.send(created.id, { text: 'hi', to: 'human@example.com' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(sent()).toEqual([]);

    // Holding `use` — even without `edit` — is enough to answer from it.
    assertCanPerformResourceAction.mockImplementation(async () => {});
    await expect(
      member.send(created.id, { text: 'hi back', to: 'human@example.com' }),
    ).resolves.toEqual({ providerMessageId: 'msg_out_1' });

    await serverDB.delete(agentAccounts);
    await serverDB.delete(agents).where(eq(agents.id, useAgentId));
    await serverDB.delete(workspaces);
  });

  it('does not release the provider resource again when revoking a revoked account', async () => {
    const { calls, fetchImpl } = createMailFetch();
    const service = buildService(fetchImpl);
    const created = await service.provision({ agentId, provider: 'agent-mail' });

    await service.revoke(created.id);
    await service.revoke(created.id);

    // The second revoke targets a row that no longer holds the inbox: it must
    // stay side-effect free, or a replaced row would delete the live inbox.
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
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

    expect(outcome).toMatchObject({
      accountId: created.id,
      event: { eventId: expect.any(String) },
      outcome: 'ignored',
      reason: 'receive-disabled',
    });
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
