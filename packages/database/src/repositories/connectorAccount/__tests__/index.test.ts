import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { ConnectorModel } from '../../../models/connector';
import { allocateLinkName, ConnectorLinkModel } from '../../../models/connectorLink';
import { userConnectorLinks, userConnectors, users, workspaces } from '../../../schemas';
import { rehomeAgentConnectorsForRecipient } from '../../../utils/agentConnectors';
import { ConnectorAccountRepo } from '../index';

const db = await getTestDB();
const vault = {
  encrypt: async (s: string) => `enc:${s}`,
  decrypt: async (s: string) => ({ plaintext: s.replace(/^enc:/, '') }),
};
const model = new ConnectorModel(db, 'alice', undefined, vault);
const links = new ConnectorLinkModel(db, 'alice', undefined, vault);
const repo = new ConnectorAccountRepo(db, 'alice', undefined, vault);
const credentials = { type: 'oauth2' as const, accessToken: 'alice-token', idToken: 'transient' };
const create = (extra = {}) =>
  model.create({
    identifier: crypto.randomUUID(),
    name: 'test',
    sourceType: 'custom',
    mcpConnectionType: 'http',
    mcpServerUrl: 'https://mcp.example',
    status: 'connected',
    ...extra,
  });
const save = (id: string, externalAccountId?: string) =>
  repo.saveAuthorization(id, {
    authorizerId: 'alice',
    credentials,
    tokenExpiresAt: null,
    target: { kind: 'new' },
    identity: { externalAccountId },
  });
beforeEach(async () => {
  await db.delete(users);
  await db.insert(users).values([{ id: 'alice' }, { id: 'bob' }]);
});
afterEach(async () => {
  await db.delete(users);
});

describe('ConnectorAccountRepo', () => {
  it('adopts legacy OAuth once, removes the old ciphertext and never persists the id token', async () => {
    const row = await create({ credentials: JSON.stringify(credentials) });
    const connector = (await model.findById(row.id))!;
    await repo.adoptLegacyCredentials(connector);
    await repo.adoptLegacyCredentials(connector);
    const result = await links.listByConnectorIds([row.id]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: 'Default',
      credentials: { accessToken: 'alice-token' },
    });
    expect(result[0].credentials).not.toHaveProperty('idToken');
    expect((await model.findById(row.id))?.credentials).toBeNull();
    const [stored] = await db.select().from(userConnectorLinks);
    expect(stored.credentials).toMatch(/^enc:/);
    expect((await model.queryPublic())[0].hasCredentials).toBe(true);
  });
  it('leaves static credentials untouched', async () => {
    const row = await create({ credentials: JSON.stringify({ type: 'bearer', token: 'static' }) });
    await repo.adoptLegacyCredentials((await model.findById(row.id))!);
    expect(await links.listByConnectorIds([row.id])).toEqual([]);
    expect((await model.findById(row.id))?.credentials).toEqual({
      type: 'bearer',
      token: 'static',
    });
  });
  it('creates, reauthorizes, deduplicates and keeps names stable', async () => {
    const row = await create();
    const first = await save(row.id, 'issuer/alice');
    expect(first.outcome).toBe('created');
    expect(await save(row.id, 'issuer/alice')).toEqual({
      linkId: first.linkId,
      outcome: 'matchedExisting',
    });
    const second = await save(row.id, 'issuer/bob');
    expect((await links.listByConnectorIds([row.id])).map((l) => l.name)).toEqual([
      'Default',
      'Account 2',
    ]);
    expect(
      await repo.saveAuthorization(row.id, {
        target: { kind: 'existing', linkId: second.linkId },
        authorizerId: 'bob',
        credentials,
        tokenExpiresAt: null,
      }),
    ).toEqual({ linkId: second.linkId, outcome: 'reauthorized' });
    await links.rename(second.linkId, ' Work ');
    await repo.removeLink(first.linkId);
    expect((await links.findById(second.linkId))?.name).toBe('Work');
    await expect(links.rename(second.linkId, ' ')).rejects.toThrow();
    await repo.removeLink(second.linkId);
    expect((await model.findById(row.id))?.status).toBe('disconnected');
  });
  it('enforces user and workspace scope for reads and writes', async () => {
    const row = await create();
    const { linkId } = await save(row.id);
    const other = new ConnectorLinkModel(db, 'bob', undefined, vault);
    expect(await other.findById(linkId)).toBeNull();
    expect(await other.listByConnectorIds([row.id])).toEqual([]);
    await other.rename(linkId, 'stolen');
    await new ConnectorAccountRepo(db, 'bob', undefined, vault).removeLink(linkId);
    expect((await links.findById(linkId))?.name).toBe('Default');
    await expect(
      new ConnectorAccountRepo(db, 'bob', undefined, vault).saveAuthorization(row.id, {
        target: { kind: 'new' },
        credentials,
        tokenExpiresAt: null,
        authorizerId: 'bob',
      }),
    ).rejects.toThrow('not found');
    await db
      .insert(workspaces)
      .values({ id: 'ws', name: 'WS', slug: 'ws', primaryOwnerId: 'alice' });
    const wsModel = new ConnectorModel(db, 'alice', 'ws', vault);
    const ws = await wsModel.create({
      identifier: 'shared',
      name: 'Shared',
      sourceType: 'custom',
      status: 'connected',
    });
    const shared = await new ConnectorAccountRepo(db, 'alice', 'ws', vault).saveAuthorization(
      ws.id,
      {
        target: { kind: 'new' },
        credentials,
        tokenExpiresAt: null,
        authorizerId: 'alice',
      },
    );
    expect(await links.findById(shared.linkId)).toBeNull();
    expect(
      await new ConnectorLinkModel(db, 'bob', 'ws', vault).findById(shared.linkId),
    ).toBeTruthy();
  });
  it('enforces uniqueness, clears links when credentials, URL or client change, and preserves them on metadata edits', async () => {
    for (const patch of [
      { mcpServerUrl: 'https://other.example' },
      { credentials: null },
      { oidcConfig: { scheme: 'dcr' as const, clientId: 'other' } },
    ]) {
      const row = await create();
      const a = await save(row.id);
      const b = await save(row.id);
      await expect(links.rename(b.linkId, 'Default')).rejects.toThrow();
      await model.update(row.id, { metadata: { customHeaders: { test: 'value' } } });
      expect(await links.findById(a.linkId)).toBeTruthy();
      await model.update(row.id, patch);
      expect(await links.listByConnectorIds([row.id])).toEqual([]);
    }
  });
  it('copies links atomically along with connector tools', async () => {
    const { agents } = await import('../../../schemas');
    await db.insert(agents).values({ id: 'agent', userId: 'alice' });
    const row = await create();
    await save(row.id);
    const copied = await model.copyToAgent(row.id, 'agent');
    expect((await links.listByConnectorIds([copied!.id]))[0]).toMatchObject({
      name: 'Default',
      credentials: { accessToken: 'alice-token' },
    });
  });
  it('allocates bounded unique names', () => {
    expect(allocateLinkName([], 'a')).toBe('a');
    expect(allocateLinkName(['a'], 'a')).toBe('a (2)');
    expect(allocateLinkName(['Default', 'Account 2'])).toBe('Account 3');
    expect(allocateLinkName(['x'.repeat(64)], 'x'.repeat(64))).toHaveLength(64);
  });
  it('removes every linked identity when an agent connector is transferred to another owner', async () => {
    const { agents } = await import('../../../schemas');
    await db.insert(agents).values({ id: 'handover-agent', userId: 'alice' });
    const row = await create({ agentId: 'handover-agent' });
    await save(row.id, 'issuer/alice');
    await rehomeAgentConnectorsForRecipient(db, {
      agentIds: ['handover-agent'],
      recipientId: 'bob',
    });
    expect(await db.select().from(userConnectorLinks)).toEqual([]);
    const received = await new ConnectorModel(db, 'bob', undefined, vault).findById(row.id);
    expect(received).toMatchObject({
      userId: 'bob',
      credentials: null,
      status: 'disconnected',
      isEnabled: false,
    });
  });
  it.each(['custom', 'marketplace'])(
    'overwrites the earliest link when an old instance writes legacy OAuth credentials (%s)',
    async (sourceType) => {
      const row = await create({ sourceType });
      const first = await save(row.id, 'issuer/first');
      const second = await save(row.id, 'issuer/second');
      // Explicit timestamps prove this follows stable creation order, not status.
      await db
        .update(userConnectorLinks)
        .set({ createdAt: new Date('2020-01-01'), status: 'error' })
        .where(eq(userConnectorLinks.id, first.linkId));
      await db
        .update(userConnectorLinks)
        .set({ createdAt: new Date('2021-01-01') })
        .where(eq(userConnectorLinks.id, second.linkId));
      const expires = new Date('2030-01-01');
      await db
        .update(userConnectors)
        .set({
          credentials: await vault.encrypt(
            JSON.stringify({ type: 'oauth2', accessToken: 'old-instance-token' }),
          ),
          tokenExpiresAt: expires,
        })
        .where(eq(userConnectors.id, row.id));
      const legacy = (await model.findById(row.id))!;
      await repo.adoptLegacyCredentials(legacy);
      await repo.adoptLegacyCredentials(legacy);
      const result = await links.listByConnectorIds([row.id]);
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: first.linkId,
        name: 'Default',
        status: 'connected',
        tokenExpiresAt: expires,
        credentials: { accessToken: 'old-instance-token' },
      });
      expect(result[1]).toMatchObject({
        id: second.linkId,
        name: 'Account 2',
        credentials: { accessToken: 'alice-token' },
      });
      const parent = await model.findById(row.id);
      expect(parent).toMatchObject({ credentials: null, tokenExpiresAt: null });
    },
  );

  it('does not create a second marketplace account when adopting a legacy write over one existing link', async () => {
    const row = await create({ sourceType: 'marketplace' });
    const { linkId } = await save(row.id);
    await db
      .update(userConnectors)
      .set({
        credentials: await vault.encrypt(
          JSON.stringify({ type: 'oauth2', accessToken: 'replacement' }),
        ),
      })
      .where(eq(userConnectors.id, row.id));
    await repo.adoptLegacyCredentials((await model.findById(row.id))!);
    expect(await links.listByConnectorIds([row.id])).toMatchObject([
      { id: linkId, name: 'Default', credentials: { accessToken: 'replacement' } },
    ]);
  });

  it.each([
    {
      label: 'updates an automatic name to the new identity',
      customName: undefined,
      occupiedName: undefined,
      expected: 'b@example.com',
    },
    {
      label: 'preserves a custom account name',
      customName: 'Work',
      occupiedName: undefined,
      expected: 'Work',
    },
    {
      label: 'deduplicates the new automatic name against other links',
      customName: undefined,
      occupiedName: 'b@example.com',
      expected: 'b@example.com (2)',
    },
    {
      label: 'does not rename without a new identity profile',
      customName: undefined,
      occupiedName: undefined,
      expected: 'a@example.com',
      noIdentity: true,
    },
  ])('$label', async ({ customName, occupiedName, expected, noIdentity }) => {
    const row = await create();
    const original = await repo.saveAuthorization(row.id, {
      target: { kind: 'new' },
      credentials,
      tokenExpiresAt: null,
      authorizerId: 'alice',
      identity: { externalAccountId: 'issuer/a', profile: { email: 'a@example.com' } },
    });
    if (customName) await links.rename(original.linkId, customName);
    if (occupiedName) {
      const other = await save(row.id, 'issuer/other');
      await links.rename(other.linkId, occupiedName);
    }
    await repo.saveAuthorization(row.id, {
      target: { kind: 'existing', linkId: original.linkId },
      credentials: { type: 'oauth2', accessToken: 'b-token' },
      tokenExpiresAt: null,
      authorizerId: 'alice',
      identity: noIdentity
        ? undefined
        : { externalAccountId: 'issuer/b', profile: { email: 'b@example.com' } },
    });
    expect(await links.findById(original.linkId)).toMatchObject({
      name: expected,
      credentials: { accessToken: 'b-token' },
    });
  });
});
