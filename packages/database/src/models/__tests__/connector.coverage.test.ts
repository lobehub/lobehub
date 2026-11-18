// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentEvalDatasets, agents, userConnectors, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ConnectorModel } from '../connector';
import { ConnectorLinkModel } from '../connectorLink';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'conncov-user';
const agentId = 'conncov-agent';
const missingId = '00000000-0000-4000-8000-000000000000';

const composio = {
  appSlug: 'gmail',
  authConfigId: 'auth-1',
  connectedAccountId: 'ca-1',
  status: 'ACTIVE',
};

const cleanup = async () => {
  await serverDB.delete(agentEvalDatasets).where(eq(agentEvalDatasets.userId, userId));
  // agents and user_connectors cascade from the owning user.
  await serverDB.delete(users).where(eq(users.id, userId));
};

const base = { name: 'Connector', sourceType: 'builtin', status: 'connected' } as const;

/** A base row written directly, as writers from before the identifier lock could duplicate one. */
const insertBaseRow = async (fields: {
  identifier: string;
  metadata?: Record<string, unknown>;
}) => {
  const [row] = await serverDB
    .insert(userConnectors)
    .values({ ...base, ...fields, userId })
    .returning();
  return row;
};

describe('ConnectorModel coverage edges', () => {
  beforeEach(async () => {
    await cleanup();
    await serverDB.insert(users).values({ id: userId });
    await serverDB.insert(agents).values({ id: agentId, userId });
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('agent-aware resolution', () => {
    it('prefers the base row mounted by the agent over a free base row', async () => {
      const model = new ConnectorModel(serverDB, userId);
      const free = await model.create({ ...base, identifier: 'linear' });
      // `create` refuses a held base identifier: seed the duplicate as an older writer left it
      const mounted = await insertBaseRow({
        identifier: 'linear',
        metadata: { mountedByAgentId: agentId },
      });

      const resolved = await model.resolveByIdentifiers(['linear'], agentId);

      expect(resolved.map((row) => row.id)).toEqual([mounted.id]);
      // Without an agent, only the free row is a candidate.
      expect((await model.resolveByIdentifiers(['linear'])).map((row) => row.id)).toEqual([
        free.id,
      ]);
    });

    it('keeps one row per identifier when duplicates share the same priority', async () => {
      const model = new ConnectorModel(serverDB, userId);
      const first = await model.create({ ...base, identifier: 'notion' });
      const second = await insertBaseRow({ identifier: 'notion' });

      const resolved = await model.resolveAll();

      expect(resolved).toHaveLength(1);
      expect([first.id, second.id]).toContain(resolved[0].id);
    });
  });

  describe('queryBaseHolders', () => {
    it('reads every base row of the scope holding the identifier, oldest first', async () => {
      const model = new ConnectorModel(serverDB, userId);
      const first = await model.create({ ...base, identifier: 'linear' });
      const mounted = await insertBaseRow({
        identifier: 'linear',
        metadata: { mountedByAgentId: agentId },
      });
      // Neither an agent's own row nor another identifier holds the base one
      await model.create({ ...base, agentId, identifier: 'linear' });
      await model.create({ ...base, identifier: 'notion' });

      expect((await model.queryBaseHolders('linear')).map((row) => row.id)).toEqual([
        first.id,
        mounted.id,
      ]);
      expect(await model.queryBaseHolders('slack')).toEqual([]);
    });
  });

  describe('empty identifier lists', () => {
    it('returns [] without querying', async () => {
      const model = new ConnectorModel(serverDB, userId);
      await model.create({ ...base, identifier: 'linear' });

      expect(await model.resolveByIdentifiers([])).toEqual([]);
      expect(await model.queryReferencesByIdentifiers([])).toEqual([]);
      expect(await model.queryComposioReferencesByIdentifiers([])).toEqual([]);
    });
  });

  describe('missing rows', () => {
    it('copyToAgent returns null and creates nothing for an unknown source', async () => {
      const model = new ConnectorModel(serverDB, userId);

      expect(await model.copyToAgent(missingId, agentId)).toBeNull();
      expect(
        await serverDB.select().from(userConnectors).where(eq(userConnectors.userId, userId)),
      ).toEqual([]);
    });

    it('findPublicById returns null for an unknown id', async () => {
      const model = new ConnectorModel(serverDB, userId);

      expect(await model.findPublicById(missingId)).toBeNull();
    });

    it('markComposioConnectionUnavailable returns false for missing or non-Composio rows', async () => {
      const model = new ConnectorModel(serverDB, userId);
      const plain = await model.create({ ...base, identifier: 'linear' });

      expect(await model.markComposioConnectionUnavailable(missingId, 'ca-1')).toBe(false);
      expect(await model.markComposioConnectionUnavailable(plain.id, 'ca-1')).toBe(false);

      const [row] = await serverDB
        .select()
        .from(userConnectors)
        .where(eq(userConnectors.id, plain.id));
      expect(row.status).toBe('connected');
    });
  });

  describe('queryComposioReferencesByIdentifiers', () => {
    it('omits the composio block for rows without Composio metadata', async () => {
      const model = new ConnectorModel(serverDB, userId);
      const plain = await model.create({ ...base, identifier: 'linear' });
      const linked = await model.create({
        ...base,
        identifier: 'gmail',
        metadata: { composio },
      });

      const refs = await model.queryComposioReferencesByIdentifiers(['linear', 'gmail']);
      const byId = new Map(refs.map((ref) => [ref.id, ref]));

      expect(byId.get(plain.id)).toEqual({ id: plain.id, isEnabled: true, status: 'connected' });
      expect(byId.get(linked.id)).toEqual({
        composio: {
          appSlug: 'gmail',
          connectedAccountId: 'ca-1',
          ownerUserId: userId,
          status: 'ACTIVE',
        },
        id: linked.id,
        isEnabled: true,
        status: 'connected',
      });
    });
  });

  describe('evaluation connections', () => {
    const createDataset = async () => {
      const [dataset] = await serverDB
        .insert(agentEvalDatasets)
        .values({ identifier: 'conncov-dataset', name: 'Eval Dataset', userId })
        .returning();
      return dataset.id;
    };

    it('requires a dataset id when building an evaluation model', () => {
      expect(() => ConnectorModel.forEvaluation(serverDB, userId, '')).toThrow(
        'A Dataset is required for evaluation connections',
      );
    });

    it('rejects the import marker on an ordinary connector create', async () => {
      const model = new ConnectorModel(serverDB, userId);

      await expect(
        model.create({ ...base, metadata: { agentEval: { datasetId: 'x' } } } as any),
      ).rejects.toThrow('Use the Dataset connection API for evaluation connections');
    });

    it('rejects a dataset outside the caller scope', async () => {
      const model = ConnectorModel.forEvaluation(serverDB, userId, missingId);

      await expect(model.create({ ...base } as any)).rejects.toThrow('Dataset not found');
    });

    it('stamps the imported marker with the owning dataset', async () => {
      const datasetId = await createDataset();
      const model = ConnectorModel.forEvaluation(serverDB, userId, datasetId);

      const row = await model.create({ ...base, identifier: 'eval-mock' } as any);

      expect(row.metadata).toEqual({ agentEval: { datasetId } });
    });

    it('requires secure storage for mock credentials', async () => {
      const datasetId = await createDataset();
      const model = ConnectorModel.forEvaluation(serverDB, userId, datasetId);

      await expect(
        model.create({
          ...base,
          credentials: JSON.stringify({ token: 't', type: 'bearer' }),
        } as any),
      ).rejects.toThrow('Secure connection storage is unavailable');
    });

    it('refuses to attach a mock connection to a normal agent', async () => {
      const datasetId = await createDataset();
      const gateKeeper = {
        decrypt: vi.fn(),
        encrypt: vi.fn(async (plaintext: string) => `enc:${plaintext}`),
      };
      const model = ConnectorModel.forEvaluation(
        serverDB,
        userId,
        datasetId,
        undefined,
        gateKeeper,
      );

      await expect(model.create({ ...base, agentId } as any)).rejects.toThrow(
        'Evaluation connections cannot be assigned to a normal Agent',
      );
    });

    it('reports a mock credential encryption failure as a stable error', async () => {
      const datasetId = await createDataset();
      const gateKeeper = {
        decrypt: vi.fn(),
        encrypt: vi.fn(async () => {
          throw new Error('vault down');
        }),
      };
      const model = ConnectorModel.forEvaluation(
        serverDB,
        userId,
        datasetId,
        undefined,
        gateKeeper,
      );
      const row = await model.create({ ...base, identifier: 'eval-mock-update' } as any);

      await expect(
        model.update(row.id, {
          credentials: JSON.stringify({ token: 't', type: 'bearer' }),
        } as any),
      ).rejects.toThrow('Could not securely store the mock connection');
    });

    it('rethrows a raw encryption failure for an ordinary connector', async () => {
      const model = new ConnectorModel(serverDB, userId);
      const row = await model.create({ ...base, identifier: 'plain-encrypt' } as any);
      const gateKeeper = {
        decrypt: vi.fn(),
        encrypt: vi.fn(async () => {
          throw new Error('vault down');
        }),
      };

      await expect(
        model.update(
          row.id,
          { credentials: JSON.stringify({ token: 't', type: 'bearer' }) } as any,
          gateKeeper,
        ),
      ).rejects.toThrow('vault down');
    });
  });
});

describe('ConnectorModel remaining edges', () => {
  beforeEach(async () => {
    await cleanup();
    await serverDB.insert(users).values({ id: userId });
    await serverDB.insert(agents).values({ id: agentId, userId });
  });

  afterEach(async () => {
    await cleanup();
  });

  it('exposes the account model of the same scope', () => {
    const model = new ConnectorModel(serverDB, userId);

    expect(model.getLinkModel()).toBeInstanceOf(ConnectorLinkModel);
  });

  it('resolves inside an evaluation Dataset scope', async () => {
    const [dataset] = await serverDB
      .insert(agentEvalDatasets)
      .values({ identifier: 'conncov-dataset', name: 'Dataset', userId })
      .returning();
    const evalModel = ConnectorModel.forEvaluation(serverDB, userId, dataset.id);
    const row = await insertBaseRow({
      identifier: 'gmail',
      metadata: { agentEval: { datasetId: dataset.id } },
    });

    expect((await evalModel.queryByIdentifiers(['gmail'])).map((r) => r.id)).toEqual([row.id]);
    expect((await evalModel.resolveByIdentifiers(['gmail'])).map((r) => r.id)).toEqual([row.id]);
    expect((await evalModel.resolveAll()).map((r) => r.id)).toEqual([row.id]);
    expect((await evalModel.queryAvailableForAgent(agentId)).map((r) => r.id)).toEqual([row.id]);
  });

  it('finds the row a write should update, and nothing for an unknown identifier', async () => {
    const model = new ConnectorModel(serverDB, userId);
    const row = await model.create({ ...base, identifier: 'gmail' });

    expect(await model.findManageableByIdentifier('gmail')).toMatchObject({ id: row.id });
    expect(await model.findManageableByIdentifier('not-there')).toBeNull();
  });

  it('finds an Agent-bound row a write should update', async () => {
    const model = new ConnectorModel(serverDB, userId);
    const [row] = await serverDB
      .insert(userConnectors)
      .values({ ...base, agentId, identifier: 'gmail', userId })
      .returning();

    expect(await model.findManageableByIdentifier('gmail', agentId)).toMatchObject({ id: row.id });
  });

  it('scopes Composio account holders to the caller outside a workspace', async () => {
    const model = new ConnectorModel(serverDB, userId);
    const row = await insertBaseRow({ identifier: 'gmail', metadata: { composio } });

    expect((await model.queryComposioAccountHolders('ca-1')).map((r) => r.id)).toEqual([row.id]);
  });

  it('picks no legacy mirrors from an empty projection', async () => {
    const model = new ConnectorModel(serverDB, userId);

    expect(await model.pickLegacyComposioMirrors([])).toEqual([]);
  });

  it('ends OAuth accounts on a server change read without a vault', async () => {
    const [row] = await serverDB
      .insert(userConnectors)
      .values({
        ...base,
        credentials: `enc:${JSON.stringify({ accessToken: 't', type: 'oauth2' })}`,
        identifier: 'gmail',
        mcpServerUrl: 'https://a.example',
        userId,
      })
      .returning();
    // No vault: the stored value is read as it is, and still recognised as OAuth.
    const plain = new ConnectorModel(serverDB, userId);

    expect(await plain.update(row.id, { mcpServerUrl: 'https://b.example' })).toBe(true);
    const [after] = await serverDB
      .select({ credentials: userConnectors.credentials })
      .from(userConnectors)
      .where(eq(userConnectors.id, row.id));
    expect(after.credentials).not.toBeNull();
  });

  it('keeps credentials it cannot decrypt instead of assuming nothing is stored', async () => {
    const [row] = await serverDB
      .insert(userConnectors)
      .values({
        ...base,
        credentials: 'enc:{"accessToken":"t","type":"oauth2"}',
        identifier: 'gmail',
        mcpServerUrl: 'https://a.example',
        userId,
      })
      .returning();
    const brokenVault = {
      decrypt: async () => {
        throw new Error('vault unavailable');
      },
      encrypt: async (value: string) => `enc:${value}`,
    };
    const guarded = new ConnectorModel(serverDB, userId, undefined, brokenVault as never);

    expect(await guarded.update(row.id, { mcpServerUrl: 'https://c.example' })).toBe(true);
    const [after] = await serverDB
      .select({ credentials: userConnectors.credentials })
      .from(userConnectors)
      .where(eq(userConnectors.id, row.id));
    // Unreadable counts as OAuth: the new server could not use it anyway.
    expect(after.credentials).toBeNull();
  });
});
