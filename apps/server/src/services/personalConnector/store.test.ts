import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { agents, userConnectors, userConnectorTools, users } from '@/database/schemas';
import { getConnectorToolPermission } from '@/libs/mcp/connectorPermissionCheck';

import { DatabasePersonalConnectionStore } from './store';

const db = await getTestDB();
const owner = () =>
  new DatabasePersonalConnectionStore(db, 'native-owner', [{ id: 'gmail', name: 'Gmail' }]);
const another = () =>
  new DatabasePersonalConnectionStore(db, 'native-other', [{ id: 'gmail', name: 'Gmail' }]);

beforeEach(async () => {
  await db.delete(users);
  await db.insert(users).values([{ id: 'native-owner' }, { id: 'native-other' }]);
  await db.insert(agents).values([
    { id: 'toby', userId: 'native-owner' },
    { id: 'work', userId: 'native-owner' },
  ]);
});

describe('personal connection persistence', () => {
  it('requires acknowledgement before replacing an existing unmanaged agent account', async () => {
    const store = owner();
    const { connection } = await store.reserve(
      'gmail',
      'legacy-replace',
      'session',
      Date.now() + 60000,
    );
    const [old] = await db
      .insert(userConnectors)
      .values({
        userId: 'native-owner',
        agentId: 'work',
        identifier: 'gmail',
        name: 'Existing Work account',
        sourceType: 'marketplace',
        status: 'connected',
        isEnabled: true,
      })
      .returning();
    const next = {
      ...connection,
      status: 'ready' as const,
      isEnabled: true,
      agentIds: ['work'],
      readToolNames: ['GMAIL_FETCH_EMAILS'],
    };
    await expect(store.save(next, connection.revision, { confirmAgents: true })).rejects.toThrow(
      /replacing/i,
    );
    const oldVersion = (await store.get(old.id))!.revision;
    await store.save(next, connection.revision, {
      confirmAgents: true,
      replacements: [{ id: old.id, revision: oldVersion }],
    });
    const legacy = (await store.get(old.id))!;
    expect(legacy.managed).toBe(false);
    expect(legacy.isEnabled).toBe(true);
    expect(legacy.activeAgentIds).toEqual([]);
  });
  it('represents an existing mounted connection as restricted to its linked agent', async () => {
    const [row] = await db
      .insert(userConnectors)
      .values({
        userId: 'native-owner',
        identifier: 'gmail',
        name: 'Linked Gmail',
        sourceType: 'marketplace',
        status: 'connected',
        metadata: { mountedByAgentId: 'work' },
      })
      .returning();
    expect((await owner().get(row.id))?.agentId).toBe('work');
  });

  it('keeps managed runtime metadata server-owned during ordinary display edits', async () => {
    const { ConnectorModel } = await import('@/database/models/connector');
    const store = owner();
    const { connection } = await store.reserve('gmail', 'display', 'session', Date.now() + 60000);
    const selected = await store.save(
      {
        ...connection,
        status: 'ready',
        agentIds: ['toby'],
        readToolNames: ['GMAIL_FETCH_EMAILS'],
        isEnabled: true,
      },
      connection.revision,
      { confirmAgents: true },
    );
    const model = new ConnectorModel(db, 'native-owner');
    await model.update(selected.id, { metadata: { description: 'A new description' } });
    const current = (await store.get(selected.id))!;
    expect(current.managed).toBe(true);
    expect(current.agentIds).toEqual(['toby']);
    await expect(model.update(selected.id, { agentId: 'work' })).rejects.toThrow(
      /confirmed|managed/i,
    );
    await expect(
      model.create({
        identifier: 'gmail',
        name: 'Forged',
        sourceType: 'marketplace',
        status: 'connected',
        metadata: { nativeAccess: { agentIds: ['work'], readToolNames: ['GMAIL_SEND_EMAIL'] } },
      }),
    ).rejects.toThrow(/reserved|managed|server/i);
  });

  it('preserves a shared provider account when another connection still references it', async () => {
    const { guardComposioRevocation } = await import('./revokeGuard');
    const store = owner();
    const { connection } = await store.reserve('gmail', 'shared', 'session', Date.now() + 60000);
    const stopped = await store.save(
      {
        ...connection,
        status: 'disconnecting',
        isEnabled: false,
        remoteId: 'shared-ca',
        backendData: { type: 'composio', appSlug: 'GMAIL', authConfigId: 'config' },
      },
      connection.revision,
    );
    const [other] = await db
      .insert(userConnectors)
      .values({
        userId: 'native-other',
        identifier: 'gmail',
        name: 'Other reference',
        sourceType: 'marketplace',
        status: 'connected',
        metadata: {
          composio: { appSlug: 'GMAIL', connectedAccountId: 'shared-ca', status: 'ACTIVE' },
        },
      })
      .returning();
    let providerRevokes = 0;
    await expect(
      guardComposioRevocation(db, 'native-owner', stopped, async () => {
        providerRevokes++;
      }),
    ).rejects.toThrow(/reference/i);
    expect(providerRevokes).toBe(0);
    const { eq } = await import('drizzle-orm');
    await db.delete(userConnectors).where(eq(userConnectors.id, other.id));
    await guardComposioRevocation(db, 'native-owner', stopped, async () => {
      providerRevokes++;
    });
    expect(providerRevokes).toBe(1);
  });

  it('requires confirmed scope assignment instead of copying native grants to another row', async () => {
    const { ConnectorModel } = await import('@/database/models/connector');
    const store = owner();
    const { connection } = await store.reserve('gmail', 'copy', 'session', Date.now() + 60000);
    await expect(
      new ConnectorModel(db, 'native-owner').copyToAgent(connection.id, 'work'),
    ).rejects.toThrow(/confirmed|managed/i);
    expect(await store.list()).toHaveLength(1);
  });
  it('retires a grant adopted after the ordinary delete initially read an unmanaged row', async () => {
    const { ConnectorModel } = await import('@/database/models/connector');
    const { eq } = await import('drizzle-orm');
    const store = owner();
    const [base, older] = await db
      .insert(userConnectors)
      .values([
        {
          userId: 'native-owner',
          identifier: 'gmail',
          name: 'Base',
          sourceType: 'marketplace',
          status: 'connected',
          isEnabled: true,
        },
        {
          userId: 'native-owner',
          agentId: 'toby',
          identifier: 'gmail',
          name: 'Older',
          sourceType: 'marketplace',
          status: 'connected',
          isEnabled: true,
        },
      ])
      .returning();
    await db.insert(userConnectorTools).values({
      userConnectorId: older.id,
      userId: 'native-owner',
      toolName: 'GMAIL_GET_PROFILE',
      crudType: 'read',
      permission: 'auto',
    });
    const before = (await store.get(base.id))!;
    const oldVersion = (await store.get(older.id))!.revision;
    // Pause only the outer candidate read. Adoption commits before delete resumes;
    // the real transaction must reread and retire that newly confirmed grant.
    const racingDB = new Proxy(db, {
      get(target, key) {
        if (key === 'select')
          return () => ({
            from: () => ({
              where: () => ({
                limit: async () => {
                  const rows = await db
                    .select()
                    .from(userConnectors)
                    .where(eq(userConnectors.id, base.id))
                    .limit(1);
                  await store.save(
                    {
                      ...before,
                      managed: true,
                      status: 'ready',
                      isEnabled: true,
                      agentIds: ['toby'],
                      readToolNames: ['GMAIL_FETCH_EMAILS'],
                    },
                    before.revision,
                    { confirmAgents: true, replacements: [{ id: older.id, revision: oldVersion }] },
                  );
                  return rows;
                },
              }),
            }),
          });
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await new ConnectorModel(racingDB, 'native-owner').delete(base.id);
    expect(await store.get(base.id)).toBeNull();
    expect(
      await getConnectorToolPermission(
        db,
        'native-owner',
        'gmail',
        'GMAIL_GET_PROFILE',
        undefined,
        'toby',
      ),
    ).toBe('disabled');
  });

  it('also stops legacy fallback when a managed connection is deleted through the existing model', async () => {
    const { ConnectorModel } = await import('@/database/models/connector');
    const store = owner();
    const { connection } = await store.reserve(
      'gmail',
      'generic-delete',
      'session',
      Date.now() + 60000,
    );
    const [older] = await db
      .insert(userConnectors)
      .values({
        userId: 'native-owner',
        agentId: 'toby',
        identifier: 'gmail',
        name: 'Older Gmail',
        sourceType: 'marketplace',
        status: 'connected',
        isEnabled: true,
      })
      .returning();
    await db.insert(userConnectorTools).values({
      userConnectorId: older.id,
      userId: 'native-owner',
      toolName: 'GMAIL_GET_PROFILE',
      crudType: 'read',
      permission: 'auto',
    });
    const selected = await store.save(
      {
        ...connection,
        status: 'ready',
        agentIds: ['toby'],
        readToolNames: ['GMAIL_FETCH_EMAILS'],
        isEnabled: true,
      },
      connection.revision,
      {
        confirmAgents: true,
        replacements: [{ id: older.id, revision: (await store.get(older.id))!.revision }],
      },
    );
    await new ConnectorModel(db, 'native-owner').delete(selected.id);
    expect(
      await getConnectorToolPermission(
        db,
        'native-owner',
        'gmail',
        'GMAIL_GET_PROFILE',
        undefined,
        'toby',
      ),
    ).toBe('disabled');
  });

  it('never projects or writes an obsolete native snapshot over a web-replaced Composio account', async () => {
    const store = owner();
    const { connection } = await store.reserve('gmail', 'snapshot', 'session', Date.now() + 60000);
    const old = await store.save(
      {
        ...connection,
        status: 'ready',
        isEnabled: true,
        agentIds: ['toby'],
        remoteId: 'ca-old',
        backendData: { type: 'composio', appSlug: 'GMAIL', authConfigId: 'config' },
        accountKey: 'old-principal',
        accountLabel: 'old@example.com',
        readToolNames: ['GMAIL_FETCH_EMAILS'],
      },
      connection.revision,
      { confirmAgents: true },
    );
    const { eq } = await import('drizzle-orm');
    const [raw] = await db.select().from(userConnectors).where(eq(userConnectors.id, old.id));
    await db
      .update(userConnectors)
      .set({
        metadata: {
          ...raw.metadata,
          composio: { ...raw.metadata!.composio!, connectedAccountId: 'ca-new' },
          nativeAccess: { ...raw.metadata!.nativeAccess!, agentIds: [] },
        },
      })
      .where(eq(userConnectors.id, old.id));
    const current = (await store.get(old.id))!;
    expect(current.remoteId).toBe('ca-new');
    expect(current.accountLabel).toBeUndefined();
    expect(current.status).not.toBe('ready');
    await expect(
      store.save({ ...old, revision: current.revision }, current.revision),
    ).rejects.toThrow(/account|identity|changed/i);
  });

  it('requires the previous account version and atomically moves a grant after confirmation', async () => {
    const store = owner();
    const { connection } = await store.reserve('gmail', 'one', 'session', Date.now() + 60000);
    const old = await store.save(
      {
        ...connection,
        status: 'ready',
        isEnabled: true,
        agentIds: ['toby'],
        readToolNames: ['GMAIL_GET_PROFILE'],
      },
      connection.revision,
      { confirmAgents: true },
    );
    const [created] = await db
      .insert(userConnectors)
      .values({
        userId: 'native-owner',
        identifier: 'gmail',
        name: 'Second Gmail',
        sourceType: 'marketplace',
        status: 'connected',
        isEnabled: false,
        metadata: { nativeAccess: { agentIds: [], readToolNames: ['GMAIL_FETCH_EMAILS'] } },
      })
      .returning();
    const next = (await store.get(created.id))!;
    await expect(
      store.save({ ...next, agentIds: ['toby'], isEnabled: true }, next.revision, {
        confirmAgents: true,
      }),
    ).rejects.toThrow(/replacing/i);
    expect((await store.get(old.id))?.agentIds).toEqual(['toby']);
    expect((await store.get(next.id))?.agentIds).toEqual([]);
    await store.save({ ...next, agentIds: ['toby'], isEnabled: true }, next.revision, {
      confirmAgents: true,
      replacements: [{ id: old.id, revision: old.revision }],
    });
    expect((await store.get(old.id))?.agentIds).toEqual([]);
    expect((await store.get(next.id))?.agentIds).toEqual(['toby']);
  });

  it('projects legacy connections without changing their existing permissions or duplicating rows', async () => {
    const store = owner();
    const entry = {
      providerId: 'gmail',
      name: 'Gmail',
      metadata: {
        composio: {
          appSlug: 'GMAIL',
          connectedAccountId: 'legacy-account',
          authConfigId: 'config',
          linkedByUserId: 'native-owner',
          status: 'ACTIVE',
        },
      },
      tools: [
        {
          toolName: 'GMAIL_SEND_EMAIL',
          crudType: 'create' as const,
          defaultPermission: 'needs_approval' as const,
        },
      ],
    };
    await store.importExisting([entry]);
    await store.importExisting([entry]);
    const rows = await store.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ managed: false, remoteId: 'legacy-account' });
    expect(
      await getConnectorToolPermission(
        db,
        'native-owner',
        'gmail',
        'GMAIL_SEND_EMAIL',
        undefined,
        'toby',
      ),
    ).toBe('needs_approval');
  });

  it('records provider data for the exact agent and grant, and ignores a revoked in-flight result', async () => {
    const { preparePersonalRead } = await import('./readEvidence');
    const store = owner();
    const { connection } = await store.reserve('gmail', 'read', 'read-session', Date.now() + 60000);
    const enabled = await store.save(
      {
        ...connection,
        status: 'ready',
        isEnabled: true,
        agentIds: ['toby'],
        readToolNames: ['GMAIL_FETCH_EMAILS'],
      },
      connection.revision,
      { confirmAgents: true },
    );
    const payload = {
      id: 'call-1',
      identifier: 'gmail',
      apiName: 'GMAIL_FETCH_EMAILS',
      arguments: '{}',
      type: 'builtin',
      source: 'lobehubSkill',
    } as const;
    const context = {
      serverDB: db,
      userId: 'native-owner',
      agentId: 'toby',
      topicId: 'topic-1',
      toolManifestMap: {},
    };
    const first = await preparePersonalRead(payload, context);
    if (!first || first.blocked) throw new Error('Expected a managed read');
    await first.finish({
      success: true,
      content: JSON.stringify({ messages: [{ id: 'm1', subject: 'Invoice' }] }),
    });
    expect((await store.get(enabled.id))?.reads?.[0]).toMatchObject({
      agentId: 'toby',
      connectionId: enabled.id,
      toolCallId: 'call-1',
      outcome: 'data',
    });
    const refreshed = await store.save((await store.get(enabled.id))!, enabled.revision);
    expect(refreshed.reads?.[0]?.outcome).toBe('data');
    const pending = await preparePersonalRead(payload, context);
    await store.save({ ...refreshed, agentIds: [], isEnabled: false }, refreshed.revision, {
      confirmAgents: true,
    });
    if (pending && !pending.blocked)
      await pending.finish({
        success: true,
        content: JSON.stringify({ messages: [{ id: 'm2', subject: 'Later' }] }),
      });
    expect((await store.get(enabled.id))?.reads).toEqual([]);
  });

  it('keeps the chosen account as a disabled selection while reauthorizing instead of falling back', async () => {
    const store = owner();
    const { connection } = await store.reserve('gmail', 'first', 'session-1', Date.now() + 60000);
    const enabled = await store.save(
      {
        ...connection,
        status: 'ready',
        isEnabled: true,
        agentIds: ['toby'],
        readToolNames: ['GMAIL_FETCH_EMAILS'],
        authorization: undefined,
      },
      connection.revision,
      { confirmAgents: true },
    );
    const pending = await store.reserve('gmail', 'next', 'session-2', Date.now() + 60000, {
      connectionId: enabled.id,
    });
    expect(pending.connection.agentIds).toEqual(['toby']);
    expect(pending.connection.isEnabled).toBe(false);
  });

  it('uses the explicitly selected connection instead of an older agent-owned account', async () => {
    const store = owner();
    const { connection } = await store.reserve(
      'gmail',
      'request-1',
      'session-1',
      Date.now() + 60000,
    );
    const [older] = await db
      .insert(userConnectors)
      .values({
        userId: 'native-owner',
        agentId: 'toby',
        identifier: 'gmail',
        name: 'Older Gmail',
        sourceType: 'marketplace',
        status: 'connected',
        isEnabled: true,
      })
      .returning();
    await db.insert(userConnectorTools).values({
      userConnectorId: connection.id,
      userId: 'native-owner',
      toolName: 'GMAIL_FETCH_EMAILS',
      crudType: 'read',
      permission: 'auto',
    });
    await store.save(
      {
        ...connection,
        status: 'ready',
        isEnabled: true,
        agentIds: ['toby'],
        readToolNames: ['GMAIL_FETCH_EMAILS'],
      },
      connection.revision,
      {
        confirmAgents: true,
        replacements: [{ id: older.id, revision: (await store.get(older.id))!.revision }],
      },
    );
    // Only the chosen account has this synced fetch tool.
    expect(
      await getConnectorToolPermission(
        db,
        'native-owner',
        'gmail',
        'GMAIL_FETCH_EMAILS',
        undefined,
        'toby',
      ),
    ).toBe('auto');
  });

  it('does not fall back to an old account after the chosen connection is closed and removed', async () => {
    const store = owner();
    const { connection } = await store.reserve(
      'gmail',
      'request-1',
      'session-1',
      Date.now() + 60000,
    );
    const [old] = await db
      .insert(userConnectors)
      .values({
        userId: 'native-owner',
        agentId: 'toby',
        identifier: 'gmail',
        name: 'Older Gmail',
        sourceType: 'marketplace',
        status: 'connected',
        isEnabled: true,
      })
      .returning();
    await db.insert(userConnectorTools).values({
      userConnectorId: old.id,
      userId: 'native-owner',
      toolName: 'GMAIL_GET_PROFILE',
      crudType: 'read',
      permission: 'auto',
    });
    const enabled = await store.save(
      {
        ...connection,
        status: 'ready',
        isEnabled: true,
        agentIds: ['toby'],
        readToolNames: ['GMAIL_FETCH_EMAILS'],
      },
      connection.revision,
      {
        confirmAgents: true,
        replacements: [{ id: old.id, revision: (await store.get(old.id))!.revision }],
      },
    );
    const disabled = await store.save(
      { ...enabled, agentIds: [], isEnabled: false },
      enabled.revision,
      { confirmAgents: true },
    );
    await store.remove(connection.id, disabled.revision);
    expect(
      await getConnectorToolPermission(
        db,
        'native-owner',
        'gmail',
        'GMAIL_GET_PROFILE',
        undefined,
        'toby',
      ),
    ).toBe('disabled');
  });

  it('respects an external disabled agent mode and clears it only on explicit confirmation', async () => {
    const store = owner();
    const { connection } = await store.reserve(
      'gmail',
      'request-1',
      'session-1',
      Date.now() + 60000,
    );
    await db.insert(userConnectorTools).values({
      userConnectorId: connection.id,
      userId: 'native-owner',
      toolName: 'GMAIL_FETCH_EMAILS',
      crudType: 'read',
      permission: 'auto',
    });
    const { eq } = await import('drizzle-orm');
    await db
      .update(agents)
      .set({ plugins: [{ identifier: 'gmail', mode: 'disabled' }] as any })
      .where(eq(agents.id, 'toby'));
    const enabled = await store.save(
      {
        ...connection,
        status: 'ready',
        isEnabled: true,
        agentIds: ['toby'],
        readToolNames: ['GMAIL_FETCH_EMAILS'],
      },
      connection.revision,
    );
    expect(
      await getConnectorToolPermission(
        db,
        'native-owner',
        'gmail',
        'GMAIL_FETCH_EMAILS',
        undefined,
        'toby',
      ),
    ).toBe('disabled');
    await store.save(enabled, enabled.revision, { confirmAgents: true });
    expect(
      await getConnectorToolPermission(
        db,
        'native-owner',
        'gmail',
        'GMAIL_FETCH_EMAILS',
        undefined,
        'toby',
      ),
    ).toBe('auto');
  });

  it('reserves a pending session idempotently and defaults the real execution policy to deny', async () => {
    const store = owner();
    const first = await store.reserve('gmail', 'request-1', 'session-1', Date.now() + 60000);
    const second = await store.reserve('gmail', 'request-1', 'session-2', Date.now() + 60000);
    expect(second.created).toBe(false);
    expect(second.connection.id).toBe(first.connection.id);
    expect(
      await getConnectorToolPermission(
        db,
        'native-owner',
        'gmail',
        'GMAIL_FETCH_EMAILS',
        undefined,
        'toby',
      ),
    ).toBe('disabled');
  });

  it('does not expose another user connection or authorization session', async () => {
    const reserved = await owner().reserve(
      'gmail',
      'request-1',
      'private-session',
      Date.now() + 60000,
    );
    expect(await another().get(reserved.connection.id)).toBeNull();
    expect(await another().getBySession('private-session')).toBeNull();
    expect(await another().list()).toEqual([]);
  });

  it('atomically writes confirmed access used by the existing tool execution guard', async () => {
    const store = owner();
    const { connection } = await store.reserve(
      'gmail',
      'request-1',
      'session-1',
      Date.now() + 60000,
    );
    await db.insert(userConnectorTools).values({
      userConnectorId: connection.id,
      userId: 'native-owner',
      toolName: 'GMAIL_FETCH_EMAILS',
      crudType: 'read',
      permission: 'auto',
    });
    const ready = await store.save(
      {
        ...connection,
        status: 'ready',
        isEnabled: true,
        agentIds: ['toby'],
        readToolNames: ['GMAIL_FETCH_EMAILS'],
      },
      connection.revision,
    );
    expect(
      await getConnectorToolPermission(
        db,
        'native-owner',
        'gmail',
        'GMAIL_FETCH_EMAILS',
        undefined,
        'toby',
      ),
    ).toBe('auto');
    expect(
      await getConnectorToolPermission(
        db,
        'native-owner',
        'gmail',
        'GMAIL_FETCH_EMAILS',
        undefined,
        'other-agent',
      ),
    ).toBe('disabled');
    await store.save({ ...ready, agentIds: [], isEnabled: false }, ready.revision);
    expect(
      await getConnectorToolPermission(
        db,
        'native-owner',
        'gmail',
        'GMAIL_FETCH_EMAILS',
        undefined,
        'toby',
      ),
    ).toBe('disabled');
  });

  it('rejects a stale update instead of overwriting a newer confirmed choice', async () => {
    const store = owner();
    const { connection } = await store.reserve(
      'gmail',
      'request-1',
      'session-1',
      Date.now() + 60000,
    );
    await store.save({ ...connection, status: 'ready', agentIds: ['toby'] }, connection.revision);
    await expect(
      store.save({ ...connection, agentIds: ['work'] }, connection.revision),
    ).rejects.toThrow(/conflict/i);
    expect((await store.get(connection.id))?.agentIds).toEqual(['toby']);
  });
});
