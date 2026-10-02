// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Router-level contract for `agentAccount` — the parts that live in the router
 * rather than the service:
 *
 * 1. Every write that names an agent proves the caller may use it.
 * 2. `create` cannot smuggle a credential in: the only way a secret enters an
 *    account is `setCredential` (behind `agent:credential:write`).
 * 3. `setCredential` answers write-only — `{ id, hasCredential }`, never the
 *    secret — and reports a missing account as NOT_FOUND.
 * 4. `update` never forwards `status`, so revocation cannot skip the provider
 *    release that `revoke` performs.
 */

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));

vi.mock('@/business/server/trpc-middlewares/rbacPermission', () => ({
  withScopedPermission: vi.fn(() => (opts: any) => opts.next({ ctx: opts.ctx })),
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: vi.fn(async () => ({})) },
}));

const assertAgentUsableBy = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/database/utils/agent-access', () => ({ assertAgentUsableBy }));

const registry = vi.hoisted(() => ({ list: vi.fn(() => []) }));
vi.mock('@/server/services/agentIdentity/providers', () => ({
  createDefaultAgentAccountRegistry: vi.fn(() => registry),
}));

const service = vi.hoisted(() => ({
  create: vi.fn(async (_params: Record<string, unknown>) => ({ id: 'acc_1' })),
  get: vi.fn(async (_id: string) => ({ agentId: 'agt_1', id: 'acc_1' })),
  list: vi.fn(async () => []),
  provision: vi.fn(async (_params: Record<string, unknown>) => ({ id: 'acc_2' })),
  revoke: vi.fn(async (_id: string, _options?: unknown): Promise<string | undefined> => 'acc_1'),
  setCredential: vi.fn(
    async (
      _id: string,
      _credential: Record<string, string>,
      _hint?: unknown,
    ): Promise<string | undefined> => 'acc_1',
  ),
  update: vi.fn(
    async (_id: string, _patch: Record<string, unknown>): Promise<string | undefined> => 'acc_1',
  ),
}));
vi.mock('@/server/services/agentIdentity', () => ({
  AgentAccountService: vi.fn(function () {
    return service;
  }),
}));

const inbox = vi.hoisted(() => ({
  findById: vi.fn(async (_id: string): Promise<unknown> => undefined),
  list: vi.fn(async (_params?: unknown): Promise<unknown[]> => []),
  markAllRead: vi.fn(async (_agentId: string) => 0),
  markRead: vi.fn(async (_ids: string[]) => 0),
  unreadCount: vi.fn(async (_agentId: string) => 0),
}));
vi.mock('@/database/models/agentInbox', () => ({
  AgentInboxModel: vi.fn(function () {
    return inbox;
  }),
}));

const { agentAccountRouter } = await import('../agentAccount');

const ctx: any = { serverDB: {}, userId: 'user-1', workspaceId: undefined };

beforeEach(() => {
  vi.clearAllMocks();
  service.create.mockResolvedValue({ id: 'acc_1' });
  service.get.mockResolvedValue({ agentId: 'agt_1', id: 'acc_1' });
  service.list.mockResolvedValue([]);
  service.provision.mockResolvedValue({ id: 'acc_2' });
  service.revoke.mockResolvedValue('acc_1');
  service.setCredential.mockResolvedValue('acc_1');
  service.update.mockResolvedValue('acc_1');
  inbox.findById.mockResolvedValue(undefined);
  inbox.list.mockResolvedValue([]);
  inbox.markAllRead.mockResolvedValue(0);
  inbox.markRead.mockResolvedValue(0);
  inbox.unreadCount.mockResolvedValue(0);
});

describe('agentAccountRouter', () => {
  describe('writes prove the caller may use the named agent', () => {
    it('checks the agent before mounting an account', async () => {
      const caller = agentAccountRouter.createCaller(ctx);

      await caller.create({
        agentId: 'agt_1',
        capabilities: { login: true, receive: false, send: false },
        identifier: 'agent@github',
        kind: 'service',
        provider: 'user',
      });

      expect(assertAgentUsableBy).toHaveBeenCalledWith({}, 'agt_1', {
        userId: 'user-1',
        workspaceId: undefined,
      });
    });

    it('checks the agent before provisioning one', async () => {
      const caller = agentAccountRouter.createCaller(ctx);

      await caller.provision({ agentId: 'agt_1', provider: 'agent-mail' });

      expect(assertAgentUsableBy).toHaveBeenCalledWith({}, 'agt_1', expect.anything());
      expect(service.provision).toHaveBeenCalledWith({
        agentId: 'agt_1',
        displayName: undefined,
        provider: 'agent-mail',
      });
    });

    it('surfaces a refused agent as NOT_FOUND rather than creating the account', async () => {
      assertAgentUsableBy.mockRejectedValueOnce(
        Object.assign(new Error('Agent not found'), { code: 'NOT_FOUND', name: 'TRPCError' }),
      );
      const caller = agentAccountRouter.createCaller(ctx);

      await expect(
        caller.create({
          agentId: 'agt_someone_else',
          capabilities: { receive: false, send: false },
          identifier: 'x@y',
          kind: 'mail',
          provider: 'user',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(service.create).not.toHaveBeenCalled();
    });
  });

  describe('credentials only enter through setCredential', () => {
    it('drops a credential smuggled into create', async () => {
      const caller = agentAccountRouter.createCaller(ctx);

      await caller.create({
        agentId: 'agt_1',
        // not part of the input schema — must never reach the service
        credential: { password: 'secret' },
        identifier: 'agent@github',
        kind: 'service',
        provider: 'user',
      } as any);

      expect(service.create).toHaveBeenCalledTimes(1);
      expect(service.create.mock.calls[0][0]).not.toHaveProperty('credential');
    });

    it('answers write-only: identity and hasCredential, never the secret', async () => {
      const caller = agentAccountRouter.createCaller(ctx);

      const result = await caller.setCredential({
        credential: { password: 'secret' },
        hint: { username: 'agent@github' },
        id: 'acc_1',
      });

      expect(result).toEqual({ hasCredential: true, id: 'acc_1', success: true });
      expect(service.setCredential).toHaveBeenCalledWith(
        'acc_1',
        { password: 'secret' },
        { username: 'agent@github' },
      );
      expect(JSON.stringify(result)).not.toContain('secret');
    });

    it('reports an unknown account as NOT_FOUND', async () => {
      service.setCredential.mockResolvedValueOnce(undefined);
      const caller = agentAccountRouter.createCaller(ctx);

      await expect(
        caller.setCredential({ credential: { password: 'secret' }, id: 'missing' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  it('never lets update move a status, so revocation keeps its provider release', async () => {
    const caller = agentAccountRouter.createCaller(ctx);

    await caller.update({ displayName: 'Renamed', id: 'acc_1', status: 'revoked' } as any);

    expect(service.update).toHaveBeenCalledWith('acc_1', { displayName: 'Renamed' });
    expect(service.revoke).not.toHaveBeenCalled();
  });

  it('passes the requested prefix through to provisioning', async () => {
    const caller = agentAccountRouter.createCaller(ctx);

    await caller.provision({ agentId: 'agt_1', prefix: 'research', provider: 'agent-mail' });

    expect(service.provision).toHaveBeenCalledWith({
      agentId: 'agt_1',
      displayName: undefined,
      prefix: 'research',
      provider: 'agent-mail',
    });
  });

  it('refuses a prefix an address cannot carry, before calling the provider', async () => {
    const caller = agentAccountRouter.createCaller(ctx);

    await expect(
      caller.provision({ agentId: 'agt_1', prefix: 'not a prefix!', provider: 'agent-mail' }),
    ).rejects.toThrow();
    expect(service.provision).not.toHaveBeenCalled();
  });

  describe('inbox', () => {
    it('reads the inbox only after proving the caller may use the agent', async () => {
      inbox.list.mockResolvedValueOnce([{ agentId: 'agt_1', id: 'msg_1' }]);
      const caller = agentAccountRouter.createCaller(ctx);

      const rows = await caller.inbox.list({ agentId: 'agt_1', unreadOnly: true });

      expect(assertAgentUsableBy).toHaveBeenCalledWith({}, 'agt_1', expect.anything());
      expect(inbox.list).toHaveBeenCalledWith({ agentId: 'agt_1', unreadOnly: true });
      expect(rows).toEqual([{ agentId: 'agt_1', id: 'msg_1' }]);
    });

    it('reports an unknown message as NOT_FOUND', async () => {
      const caller = agentAccountRouter.createCaller(ctx);

      await expect(caller.inbox.get({ id: 'missing' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('marks exactly the ids it was given and reports how many landed', async () => {
      inbox.markRead.mockResolvedValueOnce(2);
      const caller = agentAccountRouter.createCaller(ctx);

      await expect(caller.inbox.markRead({ ids: ['msg_1', 'msg_2'] })).resolves.toEqual({
        count: 2,
      });
      expect(inbox.markRead).toHaveBeenCalledWith(['msg_1', 'msg_2']);
    });

    it('checks the agent before marking the whole inbox read', async () => {
      const caller = agentAccountRouter.createCaller(ctx);

      await caller.inbox.markAllRead({ agentId: 'agt_1' });

      expect(assertAgentUsableBy).toHaveBeenCalledWith({}, 'agt_1', expect.anything());
      expect(inbox.markAllRead).toHaveBeenCalledWith('agt_1');
    });
  });
});
