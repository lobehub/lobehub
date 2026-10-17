// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LinearConnectionModel } from '@/database/models/linear';
import { linearConnections, users, workspaceMembers, workspaces } from '@/database/schemas';

import { linearRouter } from '../linear';

const serverDB = await getTestDB();
const userId = 'linear-router-user';
const otherUserId = 'linear-router-user-2';

vi.mock('@/envs/linear', () => ({
  linearEnv: { ENABLED_LINEAR: true },
}));

const mocks = vi.hoisted(() => ({ revoke: vi.fn() }));
vi.mock('@/server/services/linear/client', () => ({
  LINEAR_INSTALL_PATH: '/api/webhooks/linear/install',
  revokeLinearToken: mocks.revoke,
}));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: async () => ({
      decrypt: async (ciphertext: string) => ({ plaintext: ciphertext }),
      encrypt: async (plaintext: string) => plaintext,
    }),
  },
}));

vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const mod = await vi.importActual<{ trpc: any }>('@/libs/trpc/lambda/init');
  return { wsCompatProcedure: mod.trpc.procedure };
});

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: any) => opts.next({ ctx: { ...opts.ctx, serverDB } }),
}));

const caller = (ctx: { userId: string; workspaceId?: string | null }) =>
  linearRouter.createCaller({ ...ctx, serverDB } as any);

const connect = (scope: { userId: string; workspaceId?: string | null }) =>
  LinearConnectionModel.upsert(serverDB, {
    actorExternalId: 'linear-user',
    actorName: 'Ada',
    credentials: { accessToken: 'token' },
    organizationId: 'org-1',
    organizationName: 'Acme',
    organizationUrlKey: 'acme',
    ...scope,
  });

beforeEach(async () => {
  vi.clearAllMocks();
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(linearConnections);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
});

describe('linearRouter', () => {
  it('reports the connect configuration', async () => {
    expect(await caller({ userId }).getConfig()).toEqual({
      enabled: true,
      installPath: '/api/webhooks/linear/install',
    });
  });

  it('lists only the caller scope, without credentials', async () => {
    await connect({ userId });
    await connect({ userId: otherUserId });

    const list = await caller({ userId }).listConnections();

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ organizationName: 'Acme', userId });
    expect(list[0]).not.toHaveProperty('credentials');
  });

  it("refuses to disconnect another user's connection", async () => {
    const other = await connect({ userId: otherUserId });

    await expect(caller({ userId }).disconnect({ connectionId: other.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(mocks.revoke).not.toHaveBeenCalled();
  });

  it('lets workspace members disconnect a shared connection but not viewers', async () => {
    const [workspace] = await serverDB
      .insert(workspaces)
      .values({ name: 'ws', primaryOwnerId: otherUserId, slug: 'linear-router-ws' })
      .returning();
    const connection = await connect({ userId: otherUserId, workspaceId: workspace.id });
    await serverDB
      .insert(workspaceMembers)
      .values({ role: 'viewer', userId, workspaceId: workspace.id });
    const input = { connectionId: connection.id };

    await expect(
      caller({ userId, workspaceId: workspace.id }).disconnect(input),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await serverDB.update(workspaceMembers).set({ role: 'member' });
    await expect(caller({ userId, workspaceId: workspace.id }).disconnect(input)).resolves.toEqual({
      ok: true,
    });
  });

  it('disconnects: revokes the token at Linear and hides the connection', async () => {
    const connection = await connect({ userId });

    await caller({ userId }).disconnect({ connectionId: connection.id });

    expect(mocks.revoke).toHaveBeenCalledWith({ accessToken: 'token' }, null);
    expect(await caller({ userId }).listConnections()).toEqual([]);
    await expect(
      caller({ userId }).disconnect({ connectionId: connection.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
