import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import type { ConnectorCredentials } from '../../schemas';
import { agentEvalDatasets, agents, userConnectors, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ConnectorModel } from '../connector';
import { EvalConnectorUpdateError } from '../connectorEval';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'connector-user';
const otherUserId = 'connector-other-user';
const workspaceId = 'connector-workspace';

// A gateKeeper that wraps/unwraps payloads with a recognizable prefix so we can
// assert encryption actually ran without depending on real crypto.
const gateKeeper = {
  decrypt: vi.fn(async (ciphertext: string) => ({
    plaintext: ciphertext.replace(/^enc:/, ''),
  })),
  encrypt: vi.fn(async (plaintext: string) => `enc:${plaintext}`),
};

const apikeyCredentials: ConnectorCredentials = { apiKey: 'secret-key', type: 'apikey' };

const createBuiltinConnectorInput = (
  identifier: string,
  name: string,
): Parameters<ConnectorModel['create']>[0] => ({
  identifier,
  name,
  sourceType: 'builtin',
  status: 'connected',
});

const createGitHubConnectorInput = (): Parameters<ConnectorModel['create']>[0] => ({
  credentials: JSON.stringify(apikeyCredentials),
  identifier: 'github',
  name: 'GitHub',
  sourceType: 'builtin',
  status: 'connected',
});

beforeEach(async () => {
  vi.clearAllMocks();
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(agentEvalDatasets).values(
    ['private-dataset', 'ds-test', 'wrong-dataset'].map((id) => ({
      id,
      identifier: id,
      name: id,
      userId,
    })),
  );
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'WS', primaryOwnerId: userId, slug: 'ws' });
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('ConnectorModel', () => {
  describe('imported evaluation connection edits', () => {
    const marker = { datasetId: 'private-dataset', packageSha256: 'private-package' };
    const createEval = async () => {
      const model = ConnectorModel.forEvaluation(
        serverDB,
        userId,
        marker.datasetId,
        undefined,
        gateKeeper,
      );
      const row = await model.create({
        credentials: JSON.stringify({ type: 'bearer', token: 'old-token' }),
        identifier: `eval-${crypto.randomUUID()}`,
        name: 'Private mock',
        mcpConnectionType: 'http',
        mcpServerUrl: 'https://mock.example/mcp',
        metadata: { agentEval: marker },
        sourceType: 'custom',
        status: 'connected',
        tokenExpiresAt: new Date(123),
      });
      return { model, row };
    };

    it('hides evaluation connections from ordinary inventories and exact identifier calls', async () => {
      const { model: evaluation, row } = await createEval();
      const model = new ConnectorModel(serverDB, userId, undefined, gateKeeper);
      expect(await model.query()).toEqual([]);
      expect(await model.queryPublic()).toEqual([]);
      expect(await model.queryByIdentifiers([row.identifier])).toEqual([]);
      expect(await model.resolveByIdentifiers([row.identifier])).toEqual([]);
      expect(await model.findScopedByIdentifier(row.identifier)).toBeNull();
      expect(await model.queryReferencesByIdentifiers([row.identifier])).toEqual([]);
      expect((await evaluation.queryPublic()).map((c) => c.id)).toContain(row.id);
      await expect(
        evaluation.update(row.id, { metadata: { mountedByAgentId: 'ordinary-agent' } }),
      ).rejects.toThrow('cannot');
      const normal = await model.create({
        identifier: row.identifier,
        name: 'My real connection',
        sourceType: 'custom',
        status: 'disconnected',
      });
      expect((await model.queryPublic()).map((c) => c.id)).toEqual([normal.id]);
      expect((await model.findScopedByIdentifier(row.identifier))?.id).toBe(normal.id);
    });

    it('retains the server-owned marker through metadata replacement and keeps omitted credentials', async () => {
      const { model, row } = await createEval();
      await model.update(row.id, {
        metadata: { description: 'Updated', agentEval: { datasetId: 'spoofed' } },
      });
      const [stored] = await serverDB
        .select()
        .from(userConnectors)
        .where(eq(userConnectors.id, row.id));
      expect(stored.metadata).toEqual({ agentEval: marker, description: 'Updated' });
      expect(stored.credentials).toBe(row.credentials);
      expect(
        await new ConnectorModel(serverDB, userId).resolveByIdentifiers([row.identifier]),
      ).toEqual([]);
      await model.update(row.id, { metadata: null });
      expect((await model.findById(row.id))?.metadata).toEqual({ agentEval: marker });
    });

    it('encrypts the header-only editor payload instead of persisting metadata headers', async () => {
      const { model, row } = await createEval();
      await model.update(row.id, {
        credentials: null,
        metadata: { customHeaders: { 'X-Mock-Token': 'new-header-token' }, description: 'Renamed' },
      });
      const [stored] = await serverDB
        .select()
        .from(userConnectors)
        .where(eq(userConnectors.id, row.id));
      expect(stored.credentials).toBe(
        `enc:${JSON.stringify({ headers: { 'X-Mock-Token': 'new-header-token' }, type: 'header' })}`,
      );
      expect(stored.metadata).toEqual({ agentEval: marker, description: 'Renamed' });
      expect(stored.tokenExpiresAt).toBeNull();
      expect(stored.status).toBe('disconnected');
      expect((await model.findById(row.id))?.credentials).toEqual({
        headers: { 'X-Mock-Token': 'new-header-token' },
        type: 'header',
      });
    });

    it('combines bearer authentication and additional headers inside the encrypted column', async () => {
      const { model, row } = await createEval();
      await model.update(row.id, {
        credentials: JSON.stringify({ type: 'bearer', token: 'replacement-token' }),
        metadata: {
          customHeaders: { 'X-Tenant': 'private-tenant', 'authorization': 'old-header' },
        },
      });
      const stored = await model.findById(row.id);
      expect(stored?.credentials).toEqual({
        headers: { 'Authorization': 'Bearer replacement-token', 'X-Tenant': 'private-tenant' },
        type: 'header',
      });
      expect(stored?.metadata).toEqual({ agentEval: marker });
    });

    it('honors explicit clears on the same URL and clears resubmitted headers when changing URL', async () => {
      for (const changeUrl of [false, true]) {
        const { model, row } = await createEval();
        await model.update(row.id, {
          credentials: null,
          ...(changeUrl
            ? {
                mcpServerUrl: 'https://other-mock.example/mcp',
                metadata: { customHeaders: { Authorization: 'Bearer old-token' } },
              }
            : {}),
        });
        const stored = await model.findById(row.id);
        expect(stored?.credentials).toBeNull();
        expect(stored?.metadata?.customHeaders).toBeUndefined();
        expect(stored?.metadata?.agentEval).toEqual(marker);
        expect(stored?.status).toBe('disconnected');
        expect(stored?.tokenExpiresAt).toBeNull();
      }
    });

    it('allows changing the address with replacement credentials but rejects implicit reuse', async () => {
      const { model, row } = await createEval();
      const mcpServerUrl = 'https://other-mock.example/mcp';
      await expect(
        model.update(row.id, {
          mcpServerUrl: 'https://secret-token@other-mock.example/mcp',
          credentials: null,
        }),
      ).rejects.toThrow('without embedded credentials');
      await expect(model.update(row.id, { mcpServerUrl })).rejects.toBeInstanceOf(
        EvalConnectorUpdateError,
      );
      expect((await model.findById(row.id))?.mcpServerUrl).toBe(row.mcpServerUrl);
      await model.update(row.id, {
        mcpServerUrl,
        credentials: JSON.stringify({ type: 'bearer', token: 'new-server-token' }),
      });
      expect(await model.findById(row.id)).toMatchObject({
        mcpServerUrl,
        credentials: { type: 'bearer', token: 'new-server-token' },
      });
    });

    it('never writes imported credentials without encryption or echoes invalid header values', async () => {
      const { model, row } = await createEval();
      const withoutKey = ConnectorModel.forEvaluation(serverDB, userId, marker.datasetId);
      await expect(
        withoutKey.update(row.id, { credentials: JSON.stringify(apikeyCredentials) }),
      ).rejects.toThrow('Secure connection storage');
      await expect(
        model.update(row.id, { metadata: { customHeaders: { Bad: 'secret\r\ninjection' } } }),
      ).rejects.toThrow('Invalid mock connection headers');
      expect((await model.findById(row.id))?.credentials).toEqual({
        type: 'bearer',
        token: 'old-token',
      });
    });

    it('does not change ordinary header storage or let an ordinary update spoof import provenance', async () => {
      const model = new ConnectorModel(serverDB, userId, undefined, gateKeeper);
      const row = await model.create({
        identifier: 'ordinary',
        name: 'Ordinary',
        sourceType: 'custom',
        status: 'connected',
      });
      await model.update(row.id, {
        credentials: null,
        metadata: { agentEval: marker, customHeaders: { 'X-Token': 'ordinary-header' } },
      });
      expect(await model.findById(row.id)).toMatchObject({
        credentials: null,
        metadata: { customHeaders: { 'X-Token': 'ordinary-header' } },
        status: 'connected',
      });
      expect((await model.findById(row.id))?.metadata?.agentEval).toBeUndefined();
    });
  });

  it('keeps imported Dataset mocks out of ordinary runtime resolution while allowing exact binding', async () => {
    const model = new ConnectorModel(serverDB, userId, undefined, gateKeeper);
    const evaluation = ConnectorModel.forEvaluation(
      serverDB,
      userId,
      'ds-test',
      undefined,
      gateKeeper,
    );
    const imported = await evaluation.create({
      credentials: JSON.stringify(apikeyCredentials),
      identifier: 'private-dataset-mock',
      metadata: { agentEval: { datasetId: 'ds-test', packageSha256: 'private-hash' } },
      name: 'Dataset mock',
      sourceType: 'custom',
      status: 'connected',
    });
    gateKeeper.decrypt.mockClear();
    expect(await model.resolveByIdentifiers(['private-dataset-mock'])).toEqual([]);
    expect(await model.resolveAll()).toEqual([]);
    expect(gateKeeper.decrypt).not.toHaveBeenCalled();
    expect(await model.findPublicById(imported.id)).toBeNull();
    expect(await model.findById(imported.id)).toBeNull();
    await model.update(imported.id, { name: 'Unauthorized ordinary edit' });
    await model.delete(imported.id);
    expect((await evaluation.findById(imported.id))?.credentials).toEqual(apikeyCredentials);
    expect((await evaluation.findPublicById(imported.id))?.name).toBe('Dataset mock');
    expect(
      await ConnectorModel.forEvaluation(serverDB, userId, 'wrong-dataset').findPublicById(
        imported.id,
      ),
    ).toBeNull();
    expect(
      await ConnectorModel.forEvaluation(serverDB, otherUserId, 'ds-test').findPublicById(
        imported.id,
      ),
    ).toBeNull();
  });

  describe('create', () => {
    it('creates a connector without credentials', async () => {
      const model = new ConnectorModel(serverDB, userId);

      const result = await model.create(createBuiltinConnectorInput('linear', 'Linear'));

      expect(result.id).toBeDefined();
      expect(result.userId).toBe(userId);
      expect(result.workspaceId).toBeNull();
      expect(result.credentials).toBeNull();
      expect(gateKeeper.encrypt).not.toHaveBeenCalled();
    });

    it('encrypts credentials with the constructor gateKeeper', async () => {
      const model = new ConnectorModel(serverDB, userId, undefined, gateKeeper);

      const result = await model.create(createGitHubConnectorInput());

      expect(gateKeeper.encrypt).toHaveBeenCalledOnce();
      expect(result.credentials).toBe(`enc:${JSON.stringify(apikeyCredentials)}`);
    });

    it('stores plaintext credentials when no gateKeeper is provided', async () => {
      const model = new ConnectorModel(serverDB, userId);

      const result = await model.create({
        credentials: JSON.stringify(apikeyCredentials),
        identifier: 'custom',
        name: 'Custom',
        sourceType: 'custom',
        status: 'connected',
      });

      expect(result.credentials).toBe(JSON.stringify(apikeyCredentials));
    });

    it('persists workspaceId when the model is workspace-scoped', async () => {
      const model = new ConnectorModel(serverDB, userId, workspaceId);

      const result = await model.create(createBuiltinConnectorInput('linear', 'Linear'));

      expect(result.workspaceId).toBe(workspaceId);
    });

    it('uses the gateKeeper passed to create over the constructor one', async () => {
      const model = new ConnectorModel(serverDB, userId);
      const callGateKeeper = {
        decrypt: vi.fn(),
        encrypt: vi.fn(async (plaintext: string) => `call:${plaintext}`),
      };

      const result = await model.create(createGitHubConnectorInput(), callGateKeeper);

      expect(callGateKeeper.encrypt).toHaveBeenCalledOnce();
      expect(result.credentials).toBe(`call:${JSON.stringify(apikeyCredentials)}`);
    });
  });

  describe('query', () => {
    it('returns only the current user / workspace connectors with decrypted credentials', async () => {
      const model = new ConnectorModel(serverDB, userId, undefined, gateKeeper);

      await model.create(createGitHubConnectorInput());
      // other user's connector must not leak
      const otherModel = new ConnectorModel(serverDB, otherUserId, undefined, gateKeeper);
      await otherModel.create(createBuiltinConnectorInput('linear', 'Linear'));

      const rows = await model.query();

      expect(rows).toHaveLength(1);
      expect(rows[0].credentials).toEqual(apikeyCredentials);
      expect(gateKeeper.decrypt).toHaveBeenCalledOnce();
    });

    it('returns null credentials for rows without credentials', async () => {
      const model = new ConnectorModel(serverDB, userId, undefined, gateKeeper);
      await model.create(createBuiltinConnectorInput('linear', 'Linear'));

      const rows = await model.query();

      expect(rows[0].credentials).toBeNull();
      expect(gateKeeper.decrypt).not.toHaveBeenCalled();
    });

    it('falls back to null credentials when decryption / JSON parsing fails', async () => {
      const model = new ConnectorModel(serverDB, userId, undefined, gateKeeper);
      // write a row whose decrypted payload is not valid JSON
      await serverDB.insert(userConnectors).values({
        credentials: 'enc:not-json',
        identifier: 'broken',
        name: 'Broken',
        sourceType: 'custom',
        status: 'error',
        userId,
      });

      const rows = await model.query();

      expect(rows[0].credentials).toBeNull();
    });

    it('returns raw plaintext credentials when no gateKeeper is set', async () => {
      const model = new ConnectorModel(serverDB, userId);
      await model.create({
        credentials: JSON.stringify(apikeyCredentials),
        identifier: 'custom',
        name: 'Custom',
        sourceType: 'custom',
        status: 'connected',
      });

      const rows = await model.query();

      expect(rows[0].credentials).toEqual(apikeyCredentials);
    });
  });

  describe('public metadata reads', () => {
    it('does not select or decrypt credential and private config fields', async () => {
      const model = new ConnectorModel(serverDB, userId, undefined, gateKeeper);
      const created = await model.create({
        credentials: JSON.stringify(apikeyCredentials),
        identifier: 'public-mcp',
        mcpConnectionType: 'http',
        mcpServerUrl: 'https://mcp.example.com',
        metadata: {
          customHeaders: { 'X-Private': 'secret' },
          description: 'Public description',
          mountedByAgentId: 'mounted-agent',
        },
        name: 'Public MCP',
        oidcConfig: { clientSecret: 'secret', scheme: 'pre_registration' },
        sourceType: 'custom',
        status: 'connected',
      });
      gateKeeper.decrypt.mockClear();

      const [listed, found] = await Promise.all([
        model.queryPublic(),
        model.findPublicById(created.id),
      ]);

      expect(listed).toHaveLength(1);
      expect(found).toEqual(listed[0]);
      expect(found).toMatchObject({
        description: 'Public description',
        hasCredentials: true,
        id: created.id,
        mountedByAgentId: 'mounted-agent',
      });
      expect(found).not.toHaveProperty('credentials');
      expect(found).not.toHaveProperty('metadata');
      expect(found).not.toHaveProperty('oidcConfig');
      expect(gateKeeper.decrypt).not.toHaveBeenCalled();
    });
  });

  describe('queryByIdentifiers', () => {
    it('returns an empty array for an empty identifier list', async () => {
      const model = new ConnectorModel(serverDB, userId);
      expect(await model.queryByIdentifiers([])).toEqual([]);
    });

    it('returns only connectors matching the given identifiers', async () => {
      const model = new ConnectorModel(serverDB, userId);
      await model.create(createBuiltinConnectorInput('linear', 'Linear'));
      await model.create(createBuiltinConnectorInput('github', 'GitHub'));
      await model.create(createBuiltinConnectorInput('slack', 'Slack'));

      const rows = await model.queryByIdentifiers(['linear', 'slack']);

      expect(rows.map((r) => r.identifier).sort()).toEqual(['linear', 'slack']);
    });
  });

  describe('stable identifier order', () => {
    const createConnectors = async (model: ConnectorModel, identifiers: string[]) => {
      for (const identifier of identifiers) {
        await model.create(createBuiltinConnectorInput(identifier, identifier));
      }
    };

    // The identifier indexes make small test tables come back sorted by accident;
    // disable plain index scans so rows come back in physical (heap) order, as
    // they do in production when the planner picks a seq or bitmap heap scan.
    beforeEach(async () => {
      await serverDB.execute(sql`SET enable_indexscan = off`);
      await serverDB.execute(sql`SET enable_indexonlyscan = off`);
    });

    afterEach(async () => {
      await serverDB.execute(sql`RESET enable_indexscan`);
      await serverDB.execute(sql`RESET enable_indexonlyscan`);
    });

    it('returns connectors sorted by identifier regardless of insert, update or input order', async () => {
      const model = new ConnectorModel(serverDB, userId);
      // insert in reverse order so the physical row order differs from the sorted order
      await createConnectors(model, ['slack', 'linear', 'github']);
      const expected = ['github', 'linear', 'slack'];

      const queried = await model.queryByIdentifiers(['linear', 'slack', 'github']);
      const resolved = await model.resolveByIdentifiers(['slack', 'github', 'linear']);
      expect(queried.map((r) => r.identifier)).toEqual(expected);
      expect(resolved.map((r) => r.identifier)).toEqual(expected);
      expect((await model.resolveAll()).map((r) => r.identifier)).toEqual(expected);

      // an update rewrites the row and moves it in physical order
      const github = queried.find((r) => r.identifier === 'github')!;
      await model.update(github.id, { name: 'GitHub (renamed)' });

      expect(
        (await model.queryByIdentifiers(['github', 'linear', 'slack'])).map((r) => r.id),
      ).toEqual(queried.map((r) => r.id));
      expect(
        (await model.resolveByIdentifiers(['linear', 'github', 'slack'])).map((r) => r.id),
      ).toEqual(resolved.map((r) => r.id));
      expect((await model.resolveAll()).map((r) => r.identifier)).toEqual(expected);
    });

    it('omits unknown identifiers and does not duplicate repeated ones', async () => {
      const model = new ConnectorModel(serverDB, userId);
      await createConnectors(model, ['slack', 'github']);

      const identifiers = ['slack', 'missing', 'github', 'slack'];
      expect((await model.queryByIdentifiers(identifiers)).map((r) => r.identifier)).toEqual([
        'github',
        'slack',
      ]);
      expect((await model.resolveByIdentifiers(identifiers)).map((r) => r.identifier)).toEqual([
        'github',
        'slack',
      ]);
    });
  });

  describe('queryReferencesByIdentifiers', () => {
    it('returns scoped safe references without decrypting credentials', async () => {
      const model = new ConnectorModel(serverDB, userId, undefined, gateKeeper);
      const created = await model.create({
        credentials: JSON.stringify(apikeyCredentials),
        identifier: 'github',
        isEnabled: true,
        name: 'GitHub',
        sourceType: 'builtin',
        status: 'connected',
      });
      await new ConnectorModel(serverDB, otherUserId).create(
        createBuiltinConnectorInput('github', 'Other GitHub'),
      );
      await serverDB.insert(agents).values({ id: 'github-agent', userId });
      await model.create({
        agentId: 'github-agent',
        identifier: 'github',
        name: 'Agent GitHub',
        sourceType: 'builtin',
        status: 'connected',
      });
      gateKeeper.decrypt.mockClear();

      const rows = await model.queryReferencesByIdentifiers(['github']);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        id: created.id,
        isEnabled: true,
        status: 'connected',
      });
      expect(rows[0]).not.toHaveProperty('credentials');
      expect(gateKeeper.decrypt).not.toHaveBeenCalled();
    });
  });

  describe('Composio references', () => {
    it('returns only scoped non-credential Composio fields without decrypting', async () => {
      const model = new ConnectorModel(serverDB, userId, workspaceId, gateKeeper);
      const created = await model.create({
        credentials: JSON.stringify(apikeyCredentials),
        identifier: 'gmail',
        isEnabled: true,
        metadata: {
          composio: {
            appSlug: 'gmail',
            authConfigId: 'secret-auth-config',
            connectedAccountId: 'ca-current',
            linkedByUserId: 'gmail-linker',
            redirectUrl: 'https://secret.example/callback',
            status: 'ACTIVE',
          },
        },
        name: 'Gmail',
        sourceType: 'builtin',
        status: 'connected',
      });
      const legacy = await new ConnectorModel(serverDB, otherUserId, workspaceId).create({
        identifier: 'gmail-legacy',
        isEnabled: true,
        metadata: {
          composio: {
            appSlug: 'gmail',
            authConfigId: 'legacy-auth-config',
            connectedAccountId: 'ca-legacy',
            status: 'ACTIVE',
          },
        },
        name: 'Legacy Gmail',
        sourceType: 'builtin',
        status: 'connected',
      });
      await new ConnectorModel(serverDB, otherUserId).create({
        identifier: 'gmail',
        isEnabled: true,
        metadata: {
          composio: {
            appSlug: 'gmail',
            authConfigId: 'other-auth-config',
            connectedAccountId: 'ca-other',
            status: 'ACTIVE',
          },
        },
        name: 'Other Gmail',
        sourceType: 'builtin',
        status: 'connected',
      });
      await serverDB.insert(agents).values({ id: 'gmail-agent', userId, workspaceId });
      await model.create({
        agentId: 'gmail-agent',
        identifier: 'gmail',
        isEnabled: true,
        metadata: {
          composio: {
            appSlug: 'gmail',
            authConfigId: 'agent-auth-config',
            connectedAccountId: 'ca-agent',
            status: 'ACTIVE',
          },
        },
        name: 'Agent Gmail',
        sourceType: 'builtin',
        status: 'connected',
      });
      gateKeeper.decrypt.mockClear();

      const rows = await model.queryComposioReferencesByIdentifiers(['gmail', 'gmail-legacy']);

      expect(rows).toHaveLength(2);
      expect(rows).toEqual(
        expect.arrayContaining([
          {
            composio: {
              appSlug: 'gmail',
              connectedAccountId: 'ca-current',
              ownerUserId: 'gmail-linker',
              status: 'ACTIVE',
            },
            id: created.id,
            isEnabled: true,
            status: 'connected',
          },
          {
            composio: {
              appSlug: 'gmail',
              connectedAccountId: 'ca-legacy',
              ownerUserId: otherUserId,
              status: 'ACTIVE',
            },
            id: legacy.id,
            isEnabled: true,
            status: 'connected',
          },
        ]),
      );
      expect(JSON.stringify(rows)).not.toMatch(
        /credentials|secret-auth-config|redirectUrl|ca-other/,
      );
      expect(gateKeeper.decrypt).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('returns the decrypted connector by id', async () => {
      const model = new ConnectorModel(serverDB, userId, undefined, gateKeeper);
      const created = await model.create(createGitHubConnectorInput());

      const found = await model.findById(created.id);

      expect(found?.id).toBe(created.id);
      expect(found?.credentials).toEqual(apikeyCredentials);
    });

    it('returns null when the id does not exist', async () => {
      const model = new ConnectorModel(serverDB, userId);
      expect(await model.findById('00000000-0000-0000-0000-000000000000')).toBeNull();
    });

    it('returns null when the connector belongs to another user', async () => {
      const otherModel = new ConnectorModel(serverDB, otherUserId);
      const created = await otherModel.create(createBuiltinConnectorInput('linear', 'Linear'));

      const model = new ConnectorModel(serverDB, userId);
      expect(await model.findById(created.id)).toBeNull();
    });
  });

  describe('update', () => {
    it('updates non-credential fields without touching credentials', async () => {
      const model = new ConnectorModel(serverDB, userId, undefined, gateKeeper);
      const created = await model.create(createBuiltinConnectorInput('linear', 'Linear'));

      await model.update(created.id, { name: 'Linear Renamed' });

      const [row] = await serverDB
        .select()
        .from(userConnectors)
        .where(eq(userConnectors.id, created.id));
      expect(row.name).toBe('Linear Renamed');
      expect(gateKeeper.encrypt).not.toHaveBeenCalled();
    });

    it('encrypts credentials when provided in the patch', async () => {
      const model = new ConnectorModel(serverDB, userId, undefined, gateKeeper);
      const created = await model.create(createBuiltinConnectorInput('github', 'GitHub'));

      const newCredentials = JSON.stringify({ token: 'bearer-token', type: 'bearer' });
      await model.update(created.id, { credentials: newCredentials });

      expect(gateKeeper.encrypt).toHaveBeenCalledWith(newCredentials);
      const found = await model.findById(created.id);
      expect(found?.credentials).toEqual({ token: 'bearer-token', type: 'bearer' });
    });

    it('does not update connectors owned by another user', async () => {
      const otherModel = new ConnectorModel(serverDB, otherUserId);
      const created = await otherModel.create(createBuiltinConnectorInput('linear', 'Linear'));

      const model = new ConnectorModel(serverDB, userId);
      await model.update(created.id, { name: 'Hacked' });

      const [row] = await serverDB
        .select()
        .from(userConnectors)
        .where(eq(userConnectors.id, created.id));
      expect(row.name).toBe('Linear');
    });
  });

  describe('updateStatus', () => {
    it('updates the connector status', async () => {
      const model = new ConnectorModel(serverDB, userId);
      const created = await model.create(createBuiltinConnectorInput('linear', 'Linear'));

      await model.updateStatus(created.id, 'error');

      const found = await model.findById(created.id);
      expect(found?.status).toBe('error');
    });
  });

  describe('markComposioConnectionUnavailable', () => {
    /**
     * @example
     * A provider boundary confirms a deleted Composio account and transitions the connector
     * from ACTIVE/connected to FAILED/error without disabling the user's toggle.
     */
    it('marks a Composio connector unavailable when the remote account no longer exists', async () => {
      const model = new ConnectorModel(serverDB, userId);
      const created = await model.create({
        identifier: 'gmail',
        isEnabled: true,
        metadata: {
          composio: {
            appSlug: 'gmail',
            authConfigId: 'auth-config',
            connectedAccountId: 'ca-deleted',
            linkedByUserId: userId,
            status: 'ACTIVE',
          },
          description: 'preserved metadata',
        },
        name: 'Gmail',
        sourceType: 'marketplace',
        status: 'connected',
      });
      const handled = await model.markComposioConnectionUnavailable(created.id, 'ca-deleted');

      const found = await model.findById(created.id);
      /** @example A scoped state transition returns true once it is persisted. */
      expect(handled).toBe(true);
      /** @example The connector is excluded from active source resolution. */
      expect(found?.status).toBe('error');
      /** @example Remote health does not overwrite the user's enabled preference. */
      expect(found?.isEnabled).toBe(true);
      /** @example Composio-specific health is projected into metadata for runtime readers. */
      expect(found?.metadata?.composio?.status).toBe('FAILED');
      /** @example Unrelated metadata survives the health transition. */
      expect(found?.metadata?.description).toBe('preserved metadata');
    });

    /**
     * @example
     * A request for the replaced account cannot mark the newly connected account unavailable.
     */
    it('does not mark a replacement Composio account from a stale failure', async () => {
      // ROOT CAUSE:
      //
      // Reconnect updates the existing connector row with a new connectedAccountId.
      // An in-flight failure for the previous account used to update that row by ID alone.
      //
      // Before: the replacement account became FAILED/error.
      // We fixed this by matching the failed connectedAccountId in the health UPDATE.
      const model = new ConnectorModel(serverDB, userId);
      const created = await model.create({
        identifier: 'gmail',
        isEnabled: true,
        metadata: {
          composio: {
            appSlug: 'gmail',
            authConfigId: 'auth-config',
            connectedAccountId: 'ca-current',
            linkedByUserId: userId,
            status: 'ACTIVE',
          },
        },
        name: 'Gmail',
        sourceType: 'marketplace',
        status: 'connected',
      });

      const handled = await model.markComposioConnectionUnavailable(created.id, 'ca-previous');
      const found = await model.findById(created.id);

      expect(handled).toBe(false);
      expect(found?.status).toBe('connected');
      expect(found?.metadata?.composio?.connectedAccountId).toBe('ca-current');
      expect(found?.metadata?.composio?.status).toBe('ACTIVE');
    });
  });

  describe('delete', () => {
    it('deletes a connector owned by the user', async () => {
      const model = new ConnectorModel(serverDB, userId);
      const created = await model.create(createBuiltinConnectorInput('linear', 'Linear'));

      await model.delete(created.id);

      expect(await model.findById(created.id)).toBeNull();
    });

    it('does not delete connectors owned by another user', async () => {
      const otherModel = new ConnectorModel(serverDB, otherUserId);
      const created = await otherModel.create(createBuiltinConnectorInput('linear', 'Linear'));

      const model = new ConnectorModel(serverDB, userId);
      await model.delete(created.id);

      expect(await otherModel.findById(created.id)).not.toBeNull();
    });
  });
});
