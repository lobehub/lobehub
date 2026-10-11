// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { pickDefaultInstance } from '@lobechat/utils/environmentInstance';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  agents,
  environmentInstances,
  environments,
  projectEnvironments,
  projects,
  users,
} from '@/database/schemas';
import { SandboxStorageFilesError } from '@/server/services/sandbox/storageFiles';

import { sandboxStorageRouter } from '../sandboxStorage';

/**
 * The default-instance rules against a real database: what the router writes,
 * what it refuses, and what a refusal leaves behind. Only the execution plane
 * and the entitlement are stubbed; every row is read back from Postgres.
 */
const serverDB = await getTestDB();
const userId = 'sandbox-default-instance-user';

const plane = vi.hoisted(() => ({
  copyInstance: vi.fn(),
  deleteInstance: vi.fn(),
  readOccupancy: vi.fn(),
}));

vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const mod = await vi.importActual<{ trpc: any }>('@/libs/trpc/lambda/init');
  return { wsCompatProcedure: mod.trpc.procedure };
});

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: any) => opts.next({ ctx: { ...opts.ctx, serverDB } }),
}));

vi.mock('@/server/services/sandbox', () => ({
  resolveSandboxSessionConfig: vi.fn(),
  resolveSandboxStorageClaim: vi.fn(async () => ({ key: 'default-instance-ws', quotaBytes: 1 })),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn(function () {
    return { getSandboxStorageClient: () => plane };
  }),
}));

const caller = () => sandboxStorageRouter.createCaller({ serverDB, userId } as any);

const instancesOf = (environmentId: string) =>
  serverDB
    .select()
    .from(environmentInstances)
    .where(eq(environmentInstances.environmentId, environmentId));

const environmentExists = async (id: string) =>
  (await serverDB.select().from(environments).where(eq(environments.id, id))).length === 1;

const reset = async () => {
  await serverDB.delete(projectEnvironments);
  await serverDB.delete(projects);
  await serverDB.delete(agents);
  await serverDB.delete(environmentInstances);
  await serverDB.delete(environments);
  await serverDB.delete(users).where(eq(users.id, userId));
};

beforeEach(async () => {
  await reset();
  await serverDB.insert(users).values({ id: userId });
  plane.copyInstance.mockReset().mockResolvedValue(undefined);
  plane.deleteInstance.mockReset().mockResolvedValue(undefined);
  plane.readOccupancy.mockReset().mockResolvedValue({ held: [], unavailable: false });
});

afterEach(reset);

describe('createEnvironment', () => {
  it('persists exactly one instance with the environment, and returns it as the default', async () => {
    const created = await caller().createEnvironment({ name: 'Python 数据分析' });

    const rows = await instancesOf(created.id);
    expect(rows).toHaveLength(1);
    expect(created.defaultInstance).toMatchObject({
      environmentId: created.id,
      id: rows[0].id,
      kind: 'sandbox',
      name: 'python-数据分析',
      providerScope: 'default-instance-ws',
      status: 'pending',
      workingDirectory: 'python-数据分析',
    });
    expect(pickDefaultInstance(rows)?.id).toBe(created.defaultInstance.id);
    // Building is a sandbox cold start, left for the client's next call.
    expect(plane.readOccupancy).not.toHaveBeenCalled();
  });

  it('derives the next directory when the slug is already taken in the workspace', async () => {
    const first = await caller().createEnvironment({ name: 'Atlas' });
    const second = await caller().createEnvironment({ name: 'atlas!' });

    expect(first.defaultInstance.workingDirectory).toBe('atlas');
    expect(second.defaultInstance.workingDirectory).toBe('atlas-2');
  });

  it('leaves nothing behind when the environment name is taken', async () => {
    await caller().createEnvironment({ name: 'Taken' });

    await expect(caller().createEnvironment({ name: 'Taken' })).rejects.toMatchObject({
      message: 'DUPLICATE_ENVIRONMENT_NAME',
    });
    expect(await serverDB.select().from(environmentInstances)).toHaveLength(1);
  });
});

describe('removeInstance', () => {
  it('refuses the default instance and keeps its row', async () => {
    const created = await caller().createEnvironment({ name: 'Keep default' });

    await expect(caller().removeInstance({ id: created.defaultInstance.id })).rejects.toMatchObject(
      { code: 'FORBIDDEN', message: 'DEFAULT_INSTANCE' },
    );

    expect(plane.deleteInstance).not.toHaveBeenCalled();
    expect((await instancesOf(created.id)).map((row) => row.id)).toEqual([
      created.defaultInstance.id,
    ]);
  });

  it('removes a later copy and leaves the default in place', async () => {
    const created = await caller().createEnvironment({ name: 'Two copies' });
    const copy = await caller().createInstanceForEnvironment({ environmentId: created.id });

    await caller().removeInstance({ id: copy.id });

    expect(plane.deleteInstance).toHaveBeenCalledWith({ name: copy.id, topicId: undefined });
    expect((await instancesOf(created.id)).map((row) => row.id)).toEqual([
      created.defaultInstance.id,
    ]);
  });

  it('treats the lower id as the default when two instances share a creation time', async () => {
    const created = await caller().createEnvironment({ name: 'Tied' });
    const copy = await caller().createInstanceForEnvironment({ environmentId: created.id });
    await serverDB
      .update(environmentInstances)
      .set({ createdAt: new Date('2026-01-01T00:00:00Z') })
      .where(eq(environmentInstances.environmentId, created.id));
    const [lower, higher] = [created.defaultInstance.id, copy.id].sort();

    await expect(caller().removeInstance({ id: lower })).rejects.toMatchObject({
      message: 'DEFAULT_INSTANCE',
    });
    await caller().removeInstance({ id: higher });

    expect((await instancesOf(created.id)).map((row) => row.id)).toEqual([lower]);
  });
});

describe('copyInstance', () => {
  it('refuses a held source without writing a row', async () => {
    const created = await caller().createEnvironment({ name: 'Held' });
    plane.readOccupancy.mockResolvedValue({
      held: [{ id: created.defaultInstance.id, own: false }],
      unavailable: false,
    });

    await expect(
      caller().copyInstance({
        id: created.defaultInstance.id,
        name: 'copy',
        workingDirectory: 'c',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'INSTANCE_IN_USE' });

    expect(plane.copyInstance).not.toHaveBeenCalled();
    expect(await instancesOf(created.id)).toHaveLength(1);
  });

  it('refuses when occupancy cannot be read, rather than treating the source as free', async () => {
    const created = await caller().createEnvironment({ name: 'Unknown' });
    plane.readOccupancy.mockRejectedValue(new Error('lease store down'));

    await expect(
      caller().copyInstance({
        id: created.defaultInstance.id,
        name: 'copy',
        workingDirectory: 'c',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'INSTANCE_IN_USE' });

    expect(plane.copyInstance).not.toHaveBeenCalled();
    expect(await instancesOf(created.id)).toHaveLength(1);
  });

  it('copies an idle source into a ready instance', async () => {
    const created = await caller().createEnvironment({ name: 'Idle' });

    const copy = await caller().copyInstance({
      id: created.defaultInstance.id,
      name: 'copy',
      workingDirectory: 'idle-copy',
    });

    expect(copy.status).toBe('ready');
    expect(await instancesOf(created.id)).toHaveLength(2);
  });
});

describe('removeEnvironment', () => {
  it('takes the default instance with it', async () => {
    const created = await caller().createEnvironment({ name: 'Gone' });

    await caller().removeEnvironment({ id: created.id });

    expect(plane.deleteInstance).toHaveBeenCalledWith({
      name: created.defaultInstance.id,
      topicId: undefined,
    });
    expect(await environmentExists(created.id)).toBe(false);
    expect(await instancesOf(created.id)).toHaveLength(0);
  });

  it('rolls everything back when a run still holds the default instance', async () => {
    const created = await caller().createEnvironment({ name: 'Held env' });
    plane.deleteInstance.mockRejectedValue(new SandboxStorageFilesError('in use', 409));

    await expect(caller().removeEnvironment({ id: created.id })).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    expect(await environmentExists(created.id)).toBe(true);
    expect(await instancesOf(created.id)).toHaveLength(1);
  });

  it('refuses an environment a project still uses before touching the snapshot', async () => {
    const created = await caller().createEnvironment({ name: 'Bound' });
    const [agent] = await serverDB.insert(agents).values({ userId }).returning();
    const [project] = await serverDB
      .insert(projects)
      .values({ coordinatorAgentId: agent.id, identifier: 'BND', name: 'Bound', userId })
      .returning();
    await serverDB
      .insert(projectEnvironments)
      .values({ environmentId: created.id, projectId: project.id });

    await expect(caller().removeEnvironment({ id: created.id })).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'ENVIRONMENT_HAS_INSTANCES',
    });

    expect(plane.deleteInstance).not.toHaveBeenCalled();
    expect(await environmentExists(created.id)).toBe(true);
    expect((await instancesOf(created.id)).map((row) => row.id)).toEqual([
      created.defaultInstance.id,
    ]);
  });

  it('refuses while a copy besides the default remains', async () => {
    const created = await caller().createEnvironment({ name: 'Crowded' });
    await caller().createInstanceForEnvironment({ environmentId: created.id });

    await expect(caller().removeEnvironment({ id: created.id })).rejects.toMatchObject({
      message: 'ENVIRONMENT_HAS_INSTANCES',
    });

    expect(plane.deleteInstance).not.toHaveBeenCalled();
    expect(await instancesOf(created.id)).toHaveLength(2);
  });
});
