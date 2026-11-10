// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentAccountError } from '@/server/services/agentIdentity/errors';

/**
 * Router contract for a person's mailbox: every procedure exists, what destroys
 * mail needs edit on the agent, and a refused send reaches the client as a typed
 * error rather than a 500.
 */

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));

const scopedPermission = vi.hoisted(() => vi.fn());
vi.mock('@/business/server/trpc-middlewares/rbacPermission', () => ({
  withScopedPermission: (scope: string) => (opts: any) => {
    scopedPermission(scope, opts.path);
    return opts.next({ ctx: opts.ctx });
  },
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: vi.fn(async () => ({})) },
}));

const assertAgentUsableBy = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/database/utils/agent-access', () => ({ assertAgentUsableBy }));

const assertCanEditResource = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/server/services/resourcePermission', () => ({ assertCanEditResource }));

vi.mock('@/server/services/agentIdentity/providers', () => ({
  createDefaultAgentAccountRegistry: vi.fn(() => ({})),
}));

vi.mock('@/server/services/agentIdentity', async () => ({
  ...(await vi.importActual('@/server/services/agentIdentity/errors')),
  AgentAccountService: vi.fn(function () {
    return {};
  }),
}));

const mail = vi.hoisted(() => ({
  countUnread: vi.fn(async () => 3),
  expandToConversations: vi.fn(async () => ['expanded']),
  listAgentIds: vi.fn(async () => ['agt']),
  listConversation: vi.fn(async () => []),
  listConversations: vi.fn(async () => []),
  listPurgeTargets: vi.fn(async (): Promise<any[]> => []),
  listTrashTargets: vi.fn(async (): Promise<any[]> => []),
  markRead: vi.fn(async (ids: string[]) => ids.length),
  markUnread: vi.fn(async (ids: string[]) => ids.length),
  moveToTrash: vi.fn(async (ids: string[]) => ids),
  restore: vi.fn(async (ids: string[]) => ids.length),
  setStarred: vi.fn(async (ids: string[]) => ids.length),
}));
const drafts = vi.hoisted(() => ({
  count: vi.fn(async () => 2),
  create: vi.fn(async (params: any) => ({ id: 'd', ...params })),
  delete: vi.fn(async (ids: string[]) => ids.length),
  findById: vi.fn(async (): Promise<any> => undefined),
  list: vi.fn(async () => []),
  listAgentIds: vi.fn(async () => ['agt']),
  update: vi.fn(async (): Promise<any> => undefined),
}));
const mailbox = vi.hoisted(() => ({
  assertCanUseAll: vi.fn(async () => {}),
  purge: vi.fn(async () => ({ count: 1, failed: 0 })),
  requireAccount: vi.fn(async () => ({ agentId: 'agt', id: 'acc' })),
  send: vi.fn(async (): Promise<any> => ({ mailId: 'm', providerMessageId: 'p' })),
  sendDraft: vi.fn(async (): Promise<any> => ({ mailId: 'm', providerMessageId: 'p' })),
}));
vi.mock('@/server/services/agentIdentity/mailbox', () => ({
  AgentMailboxService: vi.fn(function () {
    return { ...mailbox, drafts, mail };
  }),
}));

const { agentAccountMailRouter } = await import('../agentAccountMail');

const caller = () =>
  agentAccountMailRouter.createCaller({
    serverDB: {},
    userId: 'user-1',
    workspaceId: 'ws-1',
  } as any);

const id = '11111111-1111-4111-8111-111111111111';
const accountId = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  assertAgentUsableBy.mockResolvedValue(undefined);
  assertCanEditResource.mockResolvedValue(undefined);
});

describe('views', () => {
  it.each(['inbox', 'sent', 'starred', 'trash'] as const)('lists %s', async (folder) => {
    await caller().list({ agentId: 'agt', folder });

    expect(assertAgentUsableBy).toHaveBeenCalledWith(expect.anything(), 'agt', {
      userId: 'user-1',
      workspaceId: 'ws-1',
    });
    expect(mail.listConversations).toHaveBeenCalledWith({ agentId: 'agt', folder });
  });

  it('refuses a view of an agent the caller cannot see', async () => {
    assertAgentUsableBy.mockRejectedValueOnce(new TRPCError({ code: 'NOT_FOUND' }));

    await expect(caller().list({ agentId: 'agt', folder: 'inbox' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(mail.listConversations).not.toHaveBeenCalled();
  });

  it('searches', async () => {
    await caller().search({ agentId: 'agt', query: ' invoice ' });

    expect(mail.listConversations).toHaveBeenCalledWith({ agentId: 'agt', query: 'invoice' });
  });

  it('counts unread and drafts', async () => {
    await expect(caller().counts({ agentId: 'agt' })).resolves.toEqual({ drafts: 2, unread: 3 });
  });

  it('reads a conversation', async () => {
    await caller().conversation({ id });

    expect(mail.listConversation).toHaveBeenCalledWith({ id });
  });
});

describe('filing', () => {
  it('marks read, unread and starred in bulk', async () => {
    await expect(caller().markRead({ ids: [id, accountId] })).resolves.toEqual({ count: 2 });
    await expect(caller().markUnread({ ids: [id] })).resolves.toEqual({ count: 1 });
    await caller().setStarred({ ids: [id], starred: true });

    expect(mail.setStarred).toHaveBeenCalledWith([id], true);
  });

  it('expands to the conversation when asked', async () => {
    await caller().markRead({ conversationIn: 'inbox', ids: [id] });

    expect(mail.expandToConversations).toHaveBeenCalledWith([id], 'inbox');
    expect(mail.markRead).toHaveBeenCalledWith(['expanded']);
  });

  it('trashes and restores behind agent:update, returning the ids to undo', async () => {
    await expect(caller().trash({ ids: [id] })).resolves.toEqual({ count: 1, ids: [id] });
    await caller().restore({ ids: [id] });

    expect(scopedPermission).toHaveBeenCalledWith('agent:update', expect.anything());
    expect(mail.restore).toHaveBeenCalledWith([id]);
  });

  it('refuses to file mail of an agent the member may not use', async () => {
    mailbox.assertCanUseAll.mockRejectedValueOnce(new TRPCError({ code: 'FORBIDDEN' }));

    await expect(caller().trash({ ids: [id] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mail.moveToTrash).not.toHaveBeenCalled();
  });

  it('returns only the ids this call moved, so undo leaves the rest alone', async () => {
    mail.moveToTrash.mockResolvedValueOnce([id]);

    await expect(caller().trash({ ids: [id, accountId] })).resolves.toEqual({
      count: 1,
      ids: [id],
    });
  });

  it('caps a batch', async () => {
    await expect(
      caller().markRead({ ids: Array.from({ length: 201 }, () => id) }),
    ).rejects.toThrow();
  });
});

describe('purge', () => {
  const target = { accountId, agentId: 'agt', id, providerMessageId: 'p' };

  it('checks edit on every owning agent before anything is deleted', async () => {
    mail.listPurgeTargets.mockResolvedValue([target, { ...target, agentId: 'agt2' }]);

    await expect(caller().purge({ ids: [id] })).resolves.toEqual({ count: 1, failed: 0 });

    expect(assertCanEditResource).toHaveBeenCalledTimes(2);
    expect(assertCanEditResource).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'agt', resourceType: 'agent', workspaceId: 'ws-1' }),
    );
    expect(mailbox.purge).toHaveBeenCalled();
  });

  it('deletes nothing for a member without edit', async () => {
    mail.listPurgeTargets.mockResolvedValue([target]);
    assertCanEditResource.mockRejectedValueOnce(new TRPCError({ code: 'FORBIDDEN' }));

    await expect(caller().purge({ ids: [id] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mailbox.purge).not.toHaveBeenCalled();
  });

  it('empties the trash in batches and stops when no progress is made', async () => {
    const batch = Array.from({ length: 200 }, () => target);
    mail.listTrashTargets.mockResolvedValue(batch);

    await expect(caller().emptyTrash({ accountId })).resolves.toMatchObject({ hasMore: true });

    mailbox.purge.mockResolvedValueOnce({ count: 0, failed: 200 });
    await expect(caller().emptyTrash({ accountId })).resolves.toMatchObject({ hasMore: false });
    expect(assertCanEditResource).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'agt' }),
    );
  });
});

describe('send', () => {
  const input = {
    accountId,
    mode: 'compose' as const,
    text: 'hi',
    to: [{ address: 'bob@x.io' }],
  };

  it('needs agent:update and a valid address', async () => {
    await caller().send(input);
    expect(scopedPermission).toHaveBeenCalledWith('agent:update', expect.anything());

    await expect(caller().send({ ...input, to: [{ address: 'nope' }] })).rejects.toThrow();
  });

  it.each([
    ['send_disabled', 'FORBIDDEN'],
    ['send_limit_daily', 'TOO_MANY_REQUESTS'],
    ['send_limit_hourly', 'TOO_MANY_REQUESTS'],
    ['send_suspended', 'FORBIDDEN'],
    ['send_failed', 'BAD_GATEWAY'],
    ['reply_target_gone', 'NOT_FOUND'],
    ['recipient_looping', 'BAD_REQUEST'],
  ] as const)('turns %s into %s with its message and code', async (code, trpcCode) => {
    mailbox.send.mockRejectedValueOnce(new AgentAccountError(code, 'shown to a person'));

    const error = await caller()
      .send(input)
      .catch((error_: unknown) => error_ as TRPCError);

    expect(error).toMatchObject({ code: trpcCode, message: 'shown to a person' });
    expect(((error as TRPCError).cause as AgentAccountError).data).toEqual({ code });
  });

  it('keeps an unexpected failure sanitized', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mailbox.send.mockRejectedValueOnce(new Error('connection string with secret'));

    await expect(caller().send(input)).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to send mail',
    });
    consoleError.mockRestore();
  });
});

describe('drafts', () => {
  it('creates against an account the caller can use', async () => {
    await caller().drafts.create({ accountId, text: 'x' });

    expect(mailbox.requireAccount).toHaveBeenCalledWith(accountId);
    expect(assertAgentUsableBy).toHaveBeenCalled();
    expect(drafts.create).toHaveBeenCalledWith(
      expect.objectContaining({ accountId, agentId: 'agt', mode: 'compose' }),
    );
  });

  it('refuses a draft on an agent the member may not use', async () => {
    mailbox.assertCanUseAll.mockRejectedValueOnce(new TRPCError({ code: 'FORBIDDEN' }));

    await expect(caller().drafts.create({ accountId, text: 'x' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(drafts.create).not.toHaveBeenCalled();
  });

  it('answers CONFLICT, not NOT_FOUND, for an edit while the draft is being sent', async () => {
    drafts.findById.mockResolvedValueOnce({ id });

    const error = await caller()
      .drafts.update({ id, text: 'x' })
      .catch((error_: unknown) => error_ as TRPCError);

    expect(error).toMatchObject({ code: 'CONFLICT' });
    expect(((error as TRPCError).cause as AgentAccountError).data).toEqual({
      code: 'draft_sending',
    });
  });

  it('answers CONFLICT when resuming a draft that is being sent', async () => {
    drafts.create.mockResolvedValueOnce(undefined as any);

    await expect(caller().drafts.create({ accountId, text: 'x' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('answers NOT_FOUND for a draft out of scope', async () => {
    await expect(caller().drafts.get({ id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(caller().drafts.update({ id, text: 'x' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('lists, deletes and sends', async () => {
    await caller().drafts.list({ agentId: 'agt' });
    await expect(caller().drafts.delete({ ids: [id] })).resolves.toEqual({ count: 1 });
    await caller().drafts.send({ id });

    expect(drafts.list).toHaveBeenCalled();
    expect(mailbox.sendDraft).toHaveBeenCalledWith(id);
  });
});
