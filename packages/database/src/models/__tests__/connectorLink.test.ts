import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, userConnectors, users, workspaces } from '../../schemas';
import { rehomeAgentConnectorsForRecipient } from '../../utils/agentConnectors';
import { ConnectorModel } from '../connector';
import {
  allocateLinkName,
  ConnectorLinkModel,
  ConnectorLinkNameTakenError,
  ConnectorLinkNotFoundError,
  LEGACY_LINK_ID,
} from '../connectorLink';

const db = await getTestDB();
const vault = {
  encrypt: async (s: string) => `enc:${s}`,
  decrypt: async (s: string) => ({ plaintext: s.replace(/^enc:/, '') }),
};
const model = new ConnectorModel(db, 'alice', undefined, vault);
const links = new ConnectorLinkModel(db, 'alice', undefined, vault);
const credentials = { type: 'oauth2' as const, accessToken: 'alice-token', idToken: 'transient' };

const create = (extra = {}) =>
  model.create({
    identifier: crypto.randomUUID(),
    name: 'test',
    sourceType: 'custom',
    mcpConnectionType: 'http',
    mcpServerUrl: 'https://mcp.example',
    oidcConfig: { clientId: 'client', scheme: 'dcr' },
    status: 'connected',
    ...extra,
  });
const save = (id: string, externalAccountId?: string, accessToken = 'alice-token') =>
  links.applyAuthorization(id, {
    authorizerId: 'alice',
    credentials: { ...credentials, accessToken },
    target: { kind: 'new' },
    identity: { externalAccountId },
  });
const storedPlaintext = async (id: string) => {
  const [row] = await db
    .select({ credentials: userConnectors.credentials })
    .from(userConnectors)
    .where(eq(userConnectors.id, id));
  return row.credentials;
};

beforeEach(async () => {
  await db.delete(users);
  await db.insert(users).values([
    { id: 'alice', fullName: 'Alice' },
    { id: 'bob', fullName: 'Bob' },
  ]);
});
afterEach(async () => {
  await db.delete(users);
});

describe('ConnectorLinkModel', () => {
  it('stores every account encrypted on the connector row, never the id token', async () => {
    const row = await create();
    await save(row.id, 'issuer/alice');
    await save(row.id, 'issuer/bob', 'bob-token');

    const stored = await storedPlaintext(row.id);
    expect(stored).toMatch(/^enc:/);
    expect(stored).not.toContain('transient');
    const result = await links.listByConnectorIds([row.id]);
    expect(result.map((l) => [l.name, l.credentials.accessToken])).toEqual([
      ['Default', 'alice-token'],
      ['Account 2', 'bob-token'],
    ]);
    expect(result[0]).toMatchObject({ authorizedByName: 'Alice', userConnectorId: row.id });
    expect((await model.queryPublic())[0].hasCredentials).toBe(true);
  });

  // Callers that spread a connector (the edit read, list projections) must
  // never carry the tokens of its accounts.
  it('keeps accounts out of the connector read', async () => {
    const row = await create();
    await save(row.id);
    expect((await model.findById(row.id))?.credentials).toBeNull();
    expect((await model.query()).find((c) => c.id === row.id)?.credentials).toBeNull();
  });

  it('reads a token written before accounts existed as one account, and keeps its id', async () => {
    const expiresAt = new Date('2030-01-01').getTime();
    const row = await create({
      credentials: JSON.stringify({ ...credentials, expiresAt }),
      status: 'error',
    });

    const [legacy] = await links.listByConnectorIds([row.id]);
    expect(legacy).toMatchObject({
      credentials: { accessToken: 'alice-token' },
      id: LEGACY_LINK_ID,
      name: 'Default',
      status: 'error',
      tokenExpiresAt: new Date(expiresAt),
      userId: 'alice',
    });
    expect(legacy.credentials).not.toHaveProperty('idToken');
    // Reading changes nothing: an instance of the previous release keeps using it
    expect(await storedPlaintext(row.id)).toBe(
      `enc:${JSON.stringify({ ...credentials, expiresAt })}`,
    );
    expect((await model.findById(row.id))?.credentials).toMatchObject({ type: 'oauth2' });

    await links.updateCredentials(row.id, LEGACY_LINK_ID, {
      type: 'oauth2',
      accessToken: 'refreshed',
    });
    await save(row.id, 'issuer/second', 'second-token');
    expect((await links.listByConnectorIds([row.id])).map((l) => [l.id, l.name])).toEqual([
      [LEGACY_LINK_ID, 'Default'],
      [expect.stringMatching(/^lnk_/), 'Account 2'],
    ]);
    expect((await links.findById(row.id, LEGACY_LINK_ID))?.credentials.accessToken).toBe(
      'refreshed',
    );
  });

  it('leaves static credentials untouched and reads them as no account', async () => {
    const row = await create({ credentials: JSON.stringify({ type: 'bearer', token: 'static' }) });
    expect(await links.listByConnectorIds([row.id])).toEqual([]);
    await links.updateStatus(row.id, LEGACY_LINK_ID, 'error');
    expect(await links.remove(row.id, LEGACY_LINK_ID)).toBeUndefined();
    await expect(links.rename(row.id, LEGACY_LINK_ID, 'x')).rejects.toBeInstanceOf(
      ConnectorLinkNotFoundError,
    );
    expect((await model.findById(row.id))?.credentials).toEqual({
      type: 'bearer',
      token: 'static',
    });
  });

  it('replaces static credentials with the first OAuth account', async () => {
    const row = await create({ credentials: JSON.stringify({ type: 'bearer', token: 'static' }) });
    await save(row.id);
    expect((await model.findById(row.id))?.credentials).toBeNull();
    expect(await links.listByConnectorIds([row.id])).toHaveLength(1);
  });

  // Each refresh locks the row and re-reads it: two accounts refreshed at once
  // must both keep their rotated tokens.
  it('keeps the tokens of accounts refreshed at the same time', async () => {
    const row = await create();
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push((await save(row.id, `issuer/${i}`)).linkId);

    await Promise.all(
      ids.map((id, i) =>
        links.updateCredentials(row.id, id, {
          type: 'oauth2',
          accessToken: `rotated-${i}`,
          expiresAt: 1000 + i,
          refreshToken: `refresh-${i}`,
        }),
      ),
    );

    const result = await links.listByConnectorIds([row.id]);
    expect(result.map((l) => l.credentials.accessToken)).toEqual(ids.map((_, i) => `rotated-${i}`));
    const [stored] = await db
      .select({ tokenExpiresAt: userConnectors.tokenExpiresAt })
      .from(userConnectors)
      .where(eq(userConnectors.id, row.id));
    expect(stored.tokenExpiresAt).toEqual(new Date(1000));
  });

  it('keeps every account added at the same time', async () => {
    const row = await create();
    await Promise.all([0, 1, 2, 3].map((i) => save(row.id, `issuer/${i}`, `token-${i}`)));
    const result = await links.listByConnectorIds([row.id]);
    expect(result.map((l) => l.credentials.accessToken).sort()).toEqual([
      'token-0',
      'token-1',
      'token-2',
      'token-3',
    ]);
    expect(new Set(result.map((l) => l.name)).size).toBe(4);
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
      await links.applyAuthorization(row.id, {
        target: { kind: 'existing', linkId: second.linkId },
        authorizerId: 'bob',
        credentials,
      }),
    ).toEqual({ linkId: second.linkId, outcome: 'reauthorized' });
    expect((await links.findById(row.id, second.linkId))?.authorizedByName).toBe('Bob');

    await links.rename(row.id, second.linkId, ' Work ');
    await expect(links.rename(row.id, first.linkId, 'Work')).rejects.toBeInstanceOf(
      ConnectorLinkNameTakenError,
    );
    await expect(links.rename(row.id, second.linkId, ' ')).rejects.toThrow();
    expect(await links.remove(row.id, first.linkId)).toEqual({ remaining: 1 });
    expect((await links.findById(row.id, second.linkId))?.name).toBe('Work');
    expect(await links.remove(row.id, second.linkId)).toEqual({ remaining: 0 });
    expect(await model.findById(row.id)).toMatchObject({
      credentials: null,
      status: 'disconnected',
      tokenExpiresAt: null,
    });
  });

  // Reauthorized while signed in as someone else, with identity discovery failing
  it('keeps no identity a fresh token was not shown to have', async () => {
    const row = await create();
    const a = await save(row.id, 'issuer/a', 'a-token');
    await links.applyAuthorization(row.id, {
      authorizerId: 'alice',
      credentials: { type: 'oauth2', accessToken: 'b-token' },
      target: { kind: 'existing', linkId: a.linkId },
    });
    expect(await links.findById(row.id, a.linkId)).toMatchObject({
      credentials: { accessToken: 'b-token' },
      externalAccountId: null,
      profile: null,
    });

    // Connecting A again adds it instead of overwriting the token held now
    expect(await save(row.id, 'issuer/a', 'a-token-2')).toMatchObject({ outcome: 'created' });
    expect(await links.findById(row.id, a.linkId)).toMatchObject({
      credentials: { accessToken: 'b-token' },
    });
  });

  it('refuses to reauthorize an account that no longer exists', async () => {
    const row = await create();
    await expect(
      links.applyAuthorization(row.id, {
        target: { kind: 'existing', linkId: 'lnk_gone' },
        authorizerId: 'alice',
        credentials,
      }),
    ).rejects.toBeInstanceOf(ConnectorLinkNotFoundError);
  });

  it('enforces user and workspace scope for reads and writes', async () => {
    const row = await create();
    const { linkId } = await save(row.id);
    const other = new ConnectorLinkModel(db, 'bob', undefined, vault);
    expect(await other.findById(row.id, linkId)).toBeNull();
    expect(await other.listByConnectorIds([row.id])).toEqual([]);
    await expect(other.rename(row.id, linkId, 'stolen')).rejects.toBeInstanceOf(
      ConnectorLinkNotFoundError,
    );
    await expect(other.remove(row.id, linkId)).rejects.toBeInstanceOf(ConnectorLinkNotFoundError);
    await expect(
      other.applyAuthorization(row.id, {
        target: { kind: 'new' },
        credentials,
        authorizerId: 'bob',
      }),
    ).rejects.toBeInstanceOf(ConnectorLinkNotFoundError);
    expect((await links.findById(row.id, linkId))?.name).toBe('Default');

    await db
      .insert(workspaces)
      .values({ id: 'ws', name: 'WS', slug: 'ws', primaryOwnerId: 'alice' });
    const ws = await new ConnectorModel(db, 'alice', 'ws', vault).create({
      identifier: 'shared',
      name: 'Shared',
      sourceType: 'custom',
      status: 'connected',
    });
    const shared = await new ConnectorLinkModel(db, 'alice', 'ws', vault).applyAuthorization(
      ws.id,
      { target: { kind: 'new' }, credentials, authorizerId: 'alice' },
    );
    expect(await links.findById(ws.id, shared.linkId)).toBeNull();
    expect(
      await new ConnectorLinkModel(db, 'bob', 'ws', vault).findById(ws.id, shared.linkId),
    ).toBeTruthy();
  });

  it('clears accounts when the credentials, URL or client change, and keeps them on other edits', async () => {
    for (const patch of [
      { mcpServerUrl: 'https://other.example' },
      { credentials: null },
      { oidcConfig: { scheme: 'dcr' as const, clientId: 'other' } },
    ]) {
      const row = await create();
      const a = await save(row.id);
      await save(row.id);
      await model.update(row.id, { metadata: { customHeaders: { test: 'value' } } });
      await model.update(row.id, { oidcConfig: { clientId: 'client', scheme: 'dcr' } });
      expect(await links.findById(row.id, a.linkId)).toBeTruthy();
      await model.update(row.id, patch);
      expect(await links.listByConnectorIds([row.id])).toEqual([]);
      expect(await storedPlaintext(row.id)).toBeNull();
    }
  });

  it('keeps static credentials when the URL changes', async () => {
    const row = await create({
      credentials: JSON.stringify({ type: 'bearer', token: 'static' }),
      oidcConfig: null,
    });
    await model.update(row.id, { mcpServerUrl: 'https://other.example' });
    expect((await model.findById(row.id))?.credentials).toEqual({
      type: 'bearer',
      token: 'static',
    });
  });

  it('copies the accounts with the connector', async () => {
    await db.insert(agents).values({ id: 'agent', userId: 'alice' });
    const row = await create();
    const { linkId } = await save(row.id);
    const copied = await model.copyToAgent(row.id, 'agent');
    expect(await links.listByConnectorIds([copied!.id])).toMatchObject([
      { id: linkId, name: 'Default', credentials: { accessToken: 'alice-token' } },
    ]);
  });

  it('allocates bounded unique names', () => {
    expect(allocateLinkName([], 'a')).toBe('a');
    expect(allocateLinkName(['a'], 'a')).toBe('a (2)');
    expect(allocateLinkName(['Default', 'Account 2'])).toBe('Account 3');
    expect(allocateLinkName(['x'.repeat(64)], 'x'.repeat(64))).toHaveLength(64);
  });

  it('removes every account when an agent connector is transferred to another owner', async () => {
    await db.insert(agents).values({ id: 'handover-agent', userId: 'alice' });
    const row = await create({ agentId: 'handover-agent' });
    await save(row.id, 'issuer/alice');
    await rehomeAgentConnectorsForRecipient(db, {
      agentIds: ['handover-agent'],
      recipientId: 'bob',
    });
    expect(await storedPlaintext(row.id)).toBeNull();
    expect(await new ConnectorModel(db, 'bob', undefined, vault).findById(row.id)).toMatchObject({
      userId: 'bob',
      credentials: null,
      status: 'disconnected',
      isEnabled: false,
    });
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
      label: 'deduplicates the new automatic name against other accounts',
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
    const original = await links.applyAuthorization(row.id, {
      target: { kind: 'new' },
      credentials,
      authorizerId: 'alice',
      identity: { externalAccountId: 'issuer/a', profile: { email: 'a@example.com' } },
    });
    if (customName) await links.rename(row.id, original.linkId, customName);
    if (occupiedName) {
      const other = await save(row.id, 'issuer/other');
      await links.rename(row.id, other.linkId, occupiedName);
    }
    await links.applyAuthorization(row.id, {
      target: { kind: 'existing', linkId: original.linkId },
      credentials: { type: 'oauth2', accessToken: 'b-token' },
      authorizerId: 'alice',
      identity: noIdentity
        ? undefined
        : { externalAccountId: 'issuer/b', profile: { email: 'b@example.com' } },
    });
    expect(await links.findById(row.id, original.linkId)).toMatchObject({
      name: expected,
      credentials: { accessToken: 'b-token' },
    });
  });
});
