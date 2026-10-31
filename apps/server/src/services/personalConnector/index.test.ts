import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type PersonalConnection, PersonalConnectorService } from './index';

const active = (): PersonalConnection => ({
  id: 'connection-1',
  userId: 'user-1',
  providerId: 'gmail',
  name: 'Gmail',
  status: 'ready',
  isEnabled: true,
  managed: true,
  revision: 1,
  agentIds: ['toby'],
  readToolNames: ['GMAIL_FETCH_EMAILS'],
  accountKey: 'principal-1',
  accountLabel: 'lin@example.com',
  remoteId: 'remote-1',
});

describe('personal connector lifecycle', () => {
  const rows = new Map<string, PersonalConnection>();
  const backend = {
    provider: { id: 'gmail', name: 'Gmail', available: true },
    authorize: vi.fn(),
    inspect: vi.fn(),
    revoke: vi.fn(),
  };
  const store = {
    list: async () => [...rows.values()].map((row) => structuredClone(row)),
    get: async (id: string) => (rows.has(id) ? structuredClone(rows.get(id)!) : null),
    getBySession: async (id: string) =>
      [...rows.values()].find((row) => row.authorization?.id === id) ?? null,
    reserve: async (
      providerId: string,
      requestId: string,
      sessionId: string,
      expiresAt: number,
    ) => {
      const found = [...rows.values()].find((row) => row.providerId === providerId);
      if (
        found?.authorization?.requestId === requestId ||
        (found?.authorization?.status === 'pending' && found.authorization.expiresAt > Date.now())
      ) {
        return { connection: structuredClone(found), created: false };
      }
      const row: PersonalConnection = {
        ...(found ?? active()),
        providerId,
        isEnabled: false,
        managed: true,
        status: 'authorizing',
        agentIds: [],
        readToolNames: [],
        revision: (found?.revision ?? 0) + 1,
        authorization: { id: sessionId, requestId, expiresAt, status: 'pending' },
      };
      rows.set(row.id, structuredClone(row));
      return { connection: structuredClone(row), created: true };
    },
    save: async (row: PersonalConnection, expectedRevision: number) => {
      if (rows.get(row.id)?.revision !== expectedRevision) throw new Error('version conflict');
      const updated = { ...structuredClone(row), revision: expectedRevision + 1 };
      rows.set(row.id, updated);
      return structuredClone(updated);
    },
    remove: async (id: string, revision: number) => {
      if (rows.get(id)?.revision !== revision) throw new Error('version conflict');
      rows.delete(id);
    },
  };
  const service = () =>
    new PersonalConnectorService({
      userId: 'user-1',
      store,
      backends: [backend],
      canEditAgents: async (ids) => ids.every((id) => ['toby', 'work'].includes(id)),
      callbackUrl: 'https://app.example.com/api/connectors/oauth/callback',
    });

  beforeEach(() => {
    rows.clear();
    vi.resetAllMocks();
    backend.authorize.mockResolvedValue({
      url: 'https://provider.example/consent',
      remoteId: 'remote-1',
    });
    backend.inspect.mockResolvedValue({
      status: 'ready',
      accountKey: 'principal-1',
      accountLabel: 'lin@example.com',
      readToolNames: ['GMAIL_FETCH_EMAILS'],
    });
    backend.revoke.mockResolvedValue(undefined);
  });

  it('exposes real provider scopes independently of the read-only execution policy', async () => {
    rows.set('connection-1', active());
    backend.inspect.mockResolvedValue({
      status: 'ready',
      accountKey: 'principal-1',
      readToolNames: ['GMAIL_FETCH_EMAILS'],
      grantedScopes: ['https://mail.google.com/'],
    });
    expect(await service().refresh('connection-1')).toMatchObject({
      grantedScopes: ['https://mail.google.com/'],
    });
  });
  it('requires new confirmation before restoring an expired account whose principal cannot be verified', async () => {
    rows.set('connection-1', {
      ...active(),
      status: 'expired',
      isEnabled: false,
      accountKey: undefined,
    });
    backend.inspect.mockResolvedValue({ status: 'ready', readToolNames: ['GMAIL_FETCH_EMAILS'] });
    expect(await service().refresh('connection-1')).toMatchObject({
      agentIds: [],
      isEnabled: false,
    });
  });
  it('does not keep an old displayed identity after authorization completes without a verified principal', async () => {
    rows.set('connection-1', {
      ...active(),
      status: 'authorizing',
      isEnabled: false,
      authorization: {
        id: 'unknown-account',
        requestId: 'request',
        expiresAt: Date.now() + 60000,
        status: 'pending',
        previous: {
          accountKey: 'principal-1',
          accountLabel: 'lin@example.com',
          agentIds: ['toby'],
          readToolNames: ['GMAIL_FETCH_EMAILS'],
          status: 'ready',
        },
      },
    });
    backend.inspect.mockResolvedValue({ status: 'ready', readToolNames: ['GMAIL_FETCH_EMAILS'] });
    const result = await service().reconcile('unknown-account');
    expect(result.accountLabel).toBeUndefined();
    expect(result.agentIds).toEqual([]);
  });
  it('finishes a provider-expired authorization while retaining the stopped agent choices', async () => {
    rows.set('connection-1', {
      ...active(),
      status: 'authorizing',
      isEnabled: false,
      authorization: {
        id: 'expired-session',
        requestId: 'expired-request',
        expiresAt: Date.now() + 60000,
        status: 'pending',
        previous: {
          accountKey: 'principal-1',
          agentIds: ['toby'],
          readToolNames: ['GMAIL_FETCH_EMAILS'],
          status: 'ready',
        },
      },
    });
    backend.inspect.mockResolvedValue({ status: 'expired', readToolNames: [] });
    expect(await service().reconcile('expired-session')).toMatchObject({
      status: 'expired',
      isEnabled: false,
      agentIds: ['toby'],
      authorization: { status: 'expired' },
    });
  });
  it('preserves disabled selections on expiry and refreshes connections without OAuth sessions', async () => {
    rows.set('connection-1', active());
    backend.inspect.mockResolvedValue({ status: 'expired', readToolNames: [] });
    const result = await service().refresh('connection-1');
    expect(result).toMatchObject({ status: 'expired', agentIds: ['toby'], isEnabled: false });
  });

  it('does not restore access to a different account after reauthorization', async () => {
    rows.set('connection-1', {
      ...active(),
      status: 'authorizing',
      isEnabled: false,
      authorization: {
        id: 'session',
        requestId: 'request',
        expiresAt: Date.now() + 60000,
        status: 'pending',
        previous: {
          accountKey: 'different-principal',
          agentIds: ['toby'],
          readToolNames: ['GMAIL_FETCH_EMAILS'],
          status: 'ready',
        },
      },
    });
    const result = await service().reconcile('session');
    expect(result).toMatchObject({ status: 'ready', agentIds: [], isEnabled: false });
  });

  it('checks live permissions and concrete tools before adopting an existing LobeHub account', async () => {
    rows.set('connection-1', { ...active(), managed: false });
    backend.inspect.mockResolvedValueOnce({ status: 'permission_required', readToolNames: [] });
    await expect(service().setAgents('connection-1', ['toby'], 1, true)).rejects.toThrow(
      /not ready/i,
    );
    expect(rows.get('connection-1')?.managed).toBe(false);
    expect(backend.inspect).toHaveBeenCalledTimes(1);
  });

  it('rejects a foreign local connection ID before reaching the provider', async () => {
    rows.set('foreign', { ...active(), id: 'foreign', userId: 'other-user' });
    await expect(service().disconnect('foreign', 1)).rejects.toThrow(/not found/i);
    expect(backend.revoke).not.toHaveBeenCalled();
  });

  it('does not grant an agent when authorization completes without confirmation', async () => {
    const started = await service().authorize({ providerId: 'gmail', requestId: 'request-1' });
    const completed = await service().reconcile(started.authorization!.id);
    expect(completed.status).toBe('ready');
    expect(completed.agentIds).toEqual([]);
    expect(rows.get(completed.id)?.isEnabled).toBe(false);
  });

  it('reuses an authorization operation on request retry instead of creating a second remote link', async () => {
    const first = await service().authorize({ providerId: 'gmail', requestId: 'request-1' });
    const retry = await service().authorize({ providerId: 'gmail', requestId: 'request-1' });
    expect(retry.authorization?.id).toBe(first.authorization?.id);
    expect(backend.authorize).toHaveBeenCalledTimes(1);
  });

  it('refuses agent confirmation while the provider is still pending', async () => {
    backend.inspect.mockResolvedValue({ status: 'pending', readToolNames: [] });
    const started = await service().authorize({ providerId: 'gmail', requestId: 'request-1' });
    await expect(service().setAgents(started.id, ['toby'], started.revision)).rejects.toThrow(
      /not ready/i,
    );
    expect(rows.get(started.id)?.agentIds).toEqual([]);
  });

  it('refuses to grant an agent owned by another user', async () => {
    rows.set('connection-1', active());
    await expect(service().setAgents('connection-1', ['foreign-agent'], 1)).rejects.toThrow(
      /agent/i,
    );
    expect(rows.get('connection-1')?.agentIds).toEqual(['toby']);
  });

  it('stores all confirmed agents together and disables access when the list becomes empty', async () => {
    rows.set('connection-1', active());
    const changed = await service().setAgents('connection-1', ['toby', 'work'], 1);
    expect(changed.agentIds).toEqual(['toby', 'work']);
    const disabled = await service().setAgents('connection-1', [], changed.revision);
    expect(disabled.agentIds).toEqual([]);
    expect(rows.get('connection-1')?.isEnabled).toBe(false);
  });

  it('reports a shared credential as local stop only and preserves the account for deliberate cleanup', async () => {
    rows.set('connection-1', active());
    backend.revoke.mockRejectedValue(
      Object.assign(new Error('Account has other connection references'), {
        code: 'CONNECTION_SHARED',
      }),
    );
    const result = await service().disconnect('connection-1', 1);
    expect(result).toMatchObject({
      localDisabled: true,
      remoteDisconnected: false,
      connection: { lastError: 'account_shared' },
    });
    expect(rows.get('connection-1')?.remoteId).toBe('remote-1');
  });
  it('retains remote retry identity but disables all local use when provider revocation fails', async () => {
    rows.set('connection-1', active());
    backend.revoke.mockRejectedValue(new Error('provider unavailable'));
    const result = await service().disconnect('connection-1', 1);
    expect(result).toMatchObject({ localDisabled: true, remoteDisconnected: false });
    expect(rows.get('connection-1')).toMatchObject({
      isEnabled: false,
      agentIds: [],
      remoteId: 'remote-1',
      status: 'disconnect_failed',
    });
    backend.revoke.mockResolvedValue(undefined);
    const retried = await service().disconnect('connection-1', rows.get('connection-1')!.revision);
    expect(retried).toMatchObject({ localDisabled: true, remoteDisconnected: true });
    expect(rows.has('connection-1')).toBe(false);
  });

  it('reconciles provider completion racing system cancellation instead of claiming no connection exists', async () => {
    const started = await service().authorize({ providerId: 'gmail', requestId: 'request-1' });
    const result = await service().reconcile(started.authorization!.id, true);
    expect(result.status).toBe('ready');
    expect(result.agentIds).toEqual([]);
  });

  it('does not let a delayed reconciliation overwrite a newer agent decision', async () => {
    const started = await service().authorize({ providerId: 'gmail', requestId: 'request-1' });
    await service().reconcile(started.authorization!.id);
    const before = rows.get(started.id)!;
    let finish!: (value: any) => void;
    backend.inspect.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const delayed = service().reconcile(started.authorization!.id);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await service().setAgents(started.id, ['work'], before.revision);
    finish({ status: 'ready', accountKey: 'principal-1', readToolNames: ['GMAIL_FETCH_EMAILS'] });
    await expect(delayed).rejects.toThrow(/conflict/i);
    expect(rows.get(started.id)?.agentIds).toEqual(['work']);
  });

  it('does not leak provider identifiers or user IDs into its public response', async () => {
    rows.set('connection-1', active());
    const response = await service().get('connection-1');
    expect(response).not.toHaveProperty('remoteId');
    expect(response).not.toHaveProperty('userId');
  });
});
