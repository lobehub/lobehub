// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import { agents, userConnectors, workspaces } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { connectorRouter } from '../../connector';
import { cleanupTestUser, createTestUser } from './setup';

// Only mock authentication/infrastructure. Row resolution and all writes use real models/SQL.
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => ({}) },
}));
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const { trpc } = await vi.importActual<{ trpc: any }>('@/libs/trpc/lambda/init');
  return {
    requireWorkspaceRoleWhenScoped: () => trpc.middleware(async (opts: any) => opts.next()),
    wsCompatProcedure: trpc.procedure,
  };
});
vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: any) => opts.next(),
}));

let db: LobeChatDatabase;
const userId = 'linear-sync-owner';
const otherUserId = 'linear-sync-other';
const workspaceId = 'linear-sync-workspace';
const agentId = 'linear-sync-agent';
const params = { identifier: 'linear', name: 'Client name', sourceType: 'marketplace' as const };

const caller = (scope?: string, actor = userId, role = 'owner') =>
  connectorRouter.createCaller({
    serverDB: db,
    userId: actor,
    workspaceId: scope,
    workspaceRole: role,
  } as any);

const seed = async (scope?: string) => {
  await db.insert(agents).values({ id: agentId, userId, workspaceId: scope });
  const common = {
    credentials: 'test-only-encrypted-credential',
    identifier: 'linear',
    metadata: { description: 'Keep stored metadata' },
    name: 'Stored Linear',
    sourceType: 'marketplace' as const,
    status: 'disconnected' as const,
    userId,
    workspaceId: scope,
  };
  const [base] = await db.insert(userConnectors).values(common).returning();
  const [agent] = await db
    .insert(userConnectors)
    .values({ ...common, agentId })
    .returning();
  const tools = new ConnectorToolModel(db, userId, scope);
  for (const row of [base, agent]) {
    await tools.upsertMany(row.id, [
      { crudType: 'write', toolName: 'create_document' },
      { crudType: 'update', toolName: 'update_document' },
      { crudType: 'read', defaultPermission: 'disabled', toolName: 'get_document' },
      { crudType: 'read', defaultPermission: 'needs_approval', toolName: 'future_tool' },
    ]);
  }
  return { agent, base, tools };
};

beforeAll(async () => {
  db = await getTestDB();
}, 60_000);

beforeEach(async () => {
  await createTestUser(db, userId);
  await createTestUser(db, otherUserId);
  await db.insert(workspaces).values({
    id: workspaceId,
    name: 'Test workspace',
    primaryOwnerId: userId,
    slug: workspaceId,
  });
});

afterEach(async () => {
  await cleanupTestUser(db, userId);
  await cleanupTestUser(db, otherUserId);
});

describe('connector client sync target identity', () => {
  it.each([undefined, workspaceId])(
    'should update only the selected same-named row in scope %s and preserve permissions/status',
    async (scope) => {
      const { agent, base, tools } = await seed(scope);
      const baseBefore = await tools.queryByConnector(base.id);
      const agentBefore = await tools.queryByConnector(agent.id);

      await expect(
        caller(scope).syncToolsFromClient({
          ...params,
          id: agent.id,
          tools: [
            { toolName: 'create_document' },
            { description: 'Updated description', toolName: 'get_document' },
            { toolName: 'update_document' },
          ],
        }),
      ).resolves.toEqual({ connectorId: agent.id, toolCount: 1 });

      expect(await tools.queryByConnector(base.id)).toEqual(baseBefore);
      const updated = await tools.queryByConnector(agent.id);
      expect(updated.map((t) => t.toolName).sort()).toEqual(['future_tool', 'get_document']);
      expect(updated.find((t) => t.toolName === 'get_document')).toMatchObject({
        description: 'Updated description',
        id: agentBefore.find((t) => t.toolName === 'get_document')!.id,
        permission: 'disabled',
      });
      expect(updated.find((t) => t.toolName === 'future_tool')).toEqual(
        agentBefore.find((t) => t.toolName === 'future_tool'),
      );

      await caller(scope).syncToolsFromClient({ ...params, id: base.id, tools: [] });
      expect(await tools.queryByConnector(agent.id)).toEqual(updated);
      expect((await tools.queryByConnector(base.id)).map((t) => t.toolName).sort()).toEqual([
        'future_tool',
        'get_document',
      ]);
      // Neither explicit refresh rewrites status, credentials, display fields or metadata.
      expect(await db.select().from(userConnectors).orderBy(userConnectors.id)).toEqual(
        [agent, base].sort((a, b) => a.id.localeCompare(b.id)),
      );
    },
  );

  it('should not create a base connector when only the selected agent connector exists', async () => {
    const { agent, base } = await seed();
    await new ConnectorModel(db, userId).delete(base.id);

    await caller().syncToolsFromClient({ ...params, id: agent.id, tools: [] });

    expect(await db.select().from(userConnectors)).toEqual([agent]);
  });

  it('should reject missing or inaccessible ids without falling back to a base connector', async () => {
    const { agent, base, tools } = await seed();
    const before = await tools.queryByConnector(base.id);
    for (const [client, id] of [
      [caller(), '00000000-0000-4000-8000-000000000000'],
      [caller(undefined, otherUserId), agent.id],
      [caller(workspaceId), agent.id],
    ] as const) {
      await expect(client.syncToolsFromClient({ ...params, id, tools: [] })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    }
    expect(await tools.queryByConnector(base.id)).toEqual(before);
    expect(await db.select().from(userConnectors)).toHaveLength(2);
  });

  it.each([{ identifier: 'notion' }, { sourceType: 'custom' as const }])(
    'should reject a client identity mismatch %j without changing the selected tools',
    async (identity) => {
      const { agent, tools } = await seed();
      const before = await tools.queryByConnector(agent.id);

      await expect(
        caller().syncToolsFromClient({
          ...params,
          ...identity,
          id: agent.id,
          tools: [],
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

      expect(await tools.queryByConnector(agent.id)).toEqual(before);
    },
  );

  it.each(['viewer', 'member'])(
    'should keep the selected workspace row read-only for an unauthorized %s',
    async (role) => {
      const { agent, tools } = await seed(workspaceId);
      const before = await tools.queryByConnector(agent.id);
      const actor = role === 'viewer' ? userId : otherUserId;

      await expect(
        caller(workspaceId, actor, role).syncToolsFromClient({
          ...params,
          id: agent.id,
          tools: [],
        }),
      ).resolves.toEqual({ connectorId: agent.id, toolCount: 0 });

      expect(await tools.queryByConnector(agent.id)).toEqual(before);
    },
  );
});
