// @vitest-environment node
import { deriveSandboxStorageKey } from '@lobechat/builtin-tool-cloud-sandbox';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EnvironmentInstanceModel } from '@/database/models/environmentInstance';
import {
  agents,
  environmentInstances,
  environments,
  projectEnvironments,
  projects,
  users,
  workspaceMembers,
  workspaces,
} from '@/database/schemas';
import { sandboxStorageBinding } from '@/server/services/sandbox/binding';
import { SandboxStorageFilesError } from '@/server/services/sandbox/storageFiles';

import { environmentRouter } from '../environment';
import { sandboxStorageRouter } from '../sandboxStorage';

/**
 * The drive and the environments initialized on it, against a real database:
 * what the routers write, what they refuse, and what a shared drive shows each
 * member. Only the execution plane and the entitlement are stubbed; every row
 * is read back from Postgres.
 */
const serverDB = await getTestDB();
const ownerId = 'drive-owner';
const memberId = 'drive-member';
// Word characters only, like every workspace id the platform issues: it is
// what lets a member drive's key split back into workspace and member.
const workspaceId = 'drive_workspace';
const STORAGE_KEY = `ws-org-${workspaceId}`;
const personalKey = (userId: string) => `ws-mem-${workspaceId}-${userId}`;

const plane = vi.hoisted(() => ({
  copyInstance: vi.fn(),
  createDirectory: vi.fn(),
  deleteFile: vi.fn(),
  deleteInstance: vi.fn(),
  getStorage: vi.fn(),
  listFiles: vi.fn(),
  readOccupancy: vi.fn(),
  renameFile: vi.fn(),
  writeFile: vi.fn(),
}));

const entitlement = vi.hoisted(() => ({ claim: vi.fn() }));

/** The storage key of every client the router made, in order: whose drive each call reached. */
const reached = vi.hoisted(() => [] as (string | undefined)[]);

vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const mod = await vi.importActual<{ trpc: any }>('@/libs/trpc/lambda/init');
  return { wsCompatProcedure: mod.trpc.procedure };
});

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: any) => opts.next({ ctx: { ...opts.ctx, serverDB } }),
}));

vi.mock('@/server/services/sandbox', async () => {
  const binding = await vi.importActual<any>('@/server/services/sandbox/binding');

  return {
    ...binding,
    ...(await vi.importActual<object>('@/server/services/sandbox/driveAccess')),
    ...(await vi.importActual<object>('@/server/services/sandbox/driveUsage')),
    forgetDriveFolders: vi.fn(),
    resolveSandboxSessionConfig: vi.fn(),
    resolveSandboxStorageClaim: entitlement.claim,
  };
});

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn(function (options: { userInfo?: { sandboxStorage?: { key?: string } } }) {
    return {
      getSandboxStorageClient: () => {
        reached.push(options?.userInfo?.sandboxStorage?.key);
        return plane;
      },
    };
  }),
}));

const asMember = (userId: string) => ({ serverDB, userId, workspaceId }) as any;
const drive = (userId = ownerId) => sandboxStorageRouter.createCaller(asMember(userId));
const definitions = (userId = ownerId) => environmentRouter.createCaller(asMember(userId));

const instancesOf = (environmentId: string) =>
  serverDB
    .select()
    .from(environmentInstances)
    .where(eq(environmentInstances.environmentId, environmentId));

const environmentExists = async (id: string) =>
  (await serverDB.select().from(environments).where(eq(environments.id, id))).length === 1;

const notFound = () => new SandboxStorageFilesError('not found', 404);

const reset = async () => {
  await serverDB.delete(projectEnvironments);
  await serverDB.delete(projects);
  await serverDB.delete(agents);
  await serverDB.delete(environmentInstances);
  await serverDB.delete(environments);
  await serverDB.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId));
  await serverDB.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await serverDB.delete(users).where(eq(users.id, ownerId));
  await serverDB.delete(users).where(eq(users.id, memberId));
};

beforeEach(async () => {
  await reset();
  await serverDB.insert(users).values([{ id: ownerId }, { id: memberId }]);
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'Team', primaryOwnerId: ownerId, slug: workspaceId });
  // The real key for the drive asked about, the way the entitlement derives it.
  entitlement.claim.mockReset().mockImplementation(async (scope: any) => {
    const key = deriveSandboxStorageKey(scope);
    return key ? { key, quotaBytes: 1 } : null;
  });
  reached.length = 0;
  plane.getStorage.mockReset().mockImplementation(async () => ({ usageBytes: 10 }));
  plane.copyInstance.mockReset().mockResolvedValue(undefined);
  plane.createDirectory.mockReset().mockImplementation(async ({ path }) => ({ path }));
  plane.deleteFile.mockReset().mockImplementation(async ({ path }) => ({ path }));
  plane.deleteInstance.mockReset().mockResolvedValue(undefined);
  plane.listFiles.mockReset().mockRejectedValue(notFound());
  plane.readOccupancy.mockReset().mockResolvedValue({ held: [], unavailable: false });
  plane.renameFile.mockReset().mockImplementation(async ({ newPath }) => ({ path: newPath }));
  plane.writeFile.mockReset().mockImplementation(async ({ path }) => ({ path }));
});

afterEach(reset);

/** An environment and one folder initialized from it, as the picker makes them. */
const initializeFolder = async (
  userId: string,
  name: string,
  visibility: 'private' | 'public' = 'private',
) => {
  const environment = await definitions(userId).createEnvironment({ name, visibility });
  const instance = await drive(userId).createInstance({
    environmentId: environment.id,
    name,
    workingDirectory: name,
  });

  return { environment, instance };
};

describe('environment definitions', () => {
  it('are written and read without any drive', async () => {
    entitlement.claim.mockResolvedValue(null);

    const created = await definitions().createEnvironment({
      configuration: { bootstrapCommand: 'pip install pandas', kind: 'code' },
      name: 'Python 数据分析',
    });

    expect(await instancesOf(created.id)).toHaveLength(0);
    await expect(definitions().listEnvironments()).resolves.toMatchObject({
      environments: [expect.objectContaining({ id: created.id, name: 'Python 数据分析' })],
    });
    await definitions().updateEnvironment({ id: created.id, name: 'Renamed' });
    await expect(drive().listInstances({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses a files environment: a folder of files is a folder on the drive', async () => {
    await expect(
      definitions().createEnvironment({ configuration: { kind: 'files' } as any, name: 'Docs' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('refuses to remove an environment a folder is still initialized from', async () => {
    const { environment, instance } = await initializeFolder(ownerId, 'atlas');

    await expect(definitions().removeEnvironment({ id: environment.id })).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'ENVIRONMENT_HAS_INSTANCES',
    });

    await drive().removeInstance({ id: instance.id });
    await definitions().removeEnvironment({ id: environment.id });
    expect(await environmentExists(environment.id)).toBe(false);
  });

  it('refuses an environment a project still uses', async () => {
    const created = await definitions().createEnvironment({ name: 'Bound' });
    const [agent] = await serverDB.insert(agents).values({ userId: ownerId }).returning();
    const [project] = await serverDB
      .insert(projects)
      .values({ coordinatorAgentId: agent.id, identifier: 'BND', name: 'Bound', userId: ownerId })
      .returning();
    await serverDB
      .insert(projectEnvironments)
      .values({ environmentId: created.id, projectId: project.id });

    await expect(definitions().removeEnvironment({ id: created.id })).rejects.toMatchObject({
      message: 'ENVIRONMENT_HAS_INSTANCES',
    });
  });
});

describe('initializing a folder', () => {
  it("creates a private environment's directory at the root of its owner's personal drive", async () => {
    const { environment, instance } = await initializeFolder(ownerId, 'atlas');

    expect(instance).toMatchObject({
      drive: 'personal',
      environmentId: environment.id,
      kind: 'sandbox',
      providerScope: personalKey(ownerId),
      status: 'pending',
      workingDirectory: 'atlas',
    });
  });

  it("creates a published environment's directory on the public drive", async () => {
    const { instance } = await initializeFolder(ownerId, 'shared', 'public');

    expect(instance).toMatchObject({ drive: 'public', providerScope: STORAGE_KEY });
  });

  it('never nests an environment directory', async () => {
    const environment = await definitions().createEnvironment({ name: 'Nested' });

    await expect(
      drive().createInstance({
        environmentId: environment.id,
        name: 'nested',
        workingDirectory: 'projects/nested',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('refuses a folder that already holds work', async () => {
    const environment = await definitions().createEnvironment({ name: 'Busy' });
    plane.listFiles.mockResolvedValue({ entries: [{ name: 'notes.md' }], path: 'busy' });

    await expect(
      drive().createInstance({
        environmentId: environment.id,
        name: 'busy',
        workingDirectory: 'busy',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'FOLDER_NOT_EMPTY' });
    expect(await instancesOf(environment.id)).toHaveLength(0);
  });

  it('removes any environment directory, the first one included', async () => {
    const { environment, instance } = await initializeFolder(ownerId, 'atlas');

    await drive().removeInstance({ id: instance.id });

    expect(plane.deleteInstance).toHaveBeenCalledWith({ name: instance.id, topicId: undefined });
    expect(await instancesOf(environment.id)).toHaveLength(0);
  });

  it('copies an occupied environment directory into a new root folder', async () => {
    const { instance } = await initializeFolder(ownerId, 'atlas');

    const copy = await drive().copyInstance({
      id: instance.id,
      name: 'atlas-copy',
      workingDirectory: 'atlas-copy',
    });

    expect(copy).toMatchObject({ status: 'ready', workingDirectory: 'atlas-copy' });
  });
});

/** A private environment's directory left on the public drive, from before personal drives. */
const legacyPrivateFolder = async (userId: string, name: string) => {
  const environment = await definitions(userId).createEnvironment({ name });
  const instance = await new EnvironmentInstanceModel(serverDB, userId, workspaceId).create({
    ...sandboxStorageBinding(STORAGE_KEY),
    environmentId: environment.id,
    name,
    workingDirectory: name,
  });

  return instance!;
};

describe("a member's personal drive", () => {
  it('is reached only by its owner', async () => {
    plane.listFiles.mockResolvedValue({ entries: [], path: '', truncated: false });
    await drive(ownerId).listFiles({ drive: 'personal' });
    await drive(memberId).listFiles({ drive: 'personal' });

    // Each member's call went to their own drive, and neither reached the other's.
    expect(reached).toEqual([personalKey(ownerId), personalKey(memberId)]);
  });

  it("lists a private environment's directory to its owner alone", async () => {
    const { instance } = await initializeFolder(ownerId, 'atlas');

    const mine = await drive(ownerId).listInstances({ drive: 'personal', withSizes: false });
    const theirs = await drive(memberId).listInstances({ drive: 'personal', withSizes: false });
    const onPublic = await drive(memberId).listInstances({ drive: 'public', withSizes: false });

    expect(mine.instances.map((entry) => entry.id)).toEqual([instance.id]);
    expect(theirs.instances).toEqual([]);
    expect(onPublic.instances).toEqual([]);
  });

  it("refuses another member every route into an instance on the owner's drive", async () => {
    const { instance } = await initializeFolder(ownerId, 'atlas');
    reached.length = 0;

    for (const call of [
      () => drive(memberId).listFiles({ instanceId: instance.id }),
      () => drive(memberId).readFile({ instanceId: instance.id, path: 'atlas/.env' }),
      () => drive(memberId).startInstanceBuild({ id: instance.id }),
      () => drive(memberId).removeInstance({ id: instance.id }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    expect(reached.filter((key) => key === personalKey(ownerId))).toEqual([]);
  });
});

describe('the public drive', () => {
  it('is the same drive for every member', async () => {
    plane.listFiles.mockResolvedValue({ entries: [], path: '', truncated: false });
    await drive(ownerId).listFiles({ drive: 'public' });
    await drive(memberId).listFiles({});

    expect(reached).toEqual([STORAGE_KEY, STORAGE_KEY]);
  });

  it('hides a private environment directory left there, from its owner too', async () => {
    const legacy = await legacyPrivateFolder(ownerId, 'secret');
    await initializeFolder(ownerId, 'shared', 'public');
    plane.listFiles.mockResolvedValue({
      entries: ['projA', 'secret', 'shared'].map((name) => ({
        isDirectory: true,
        name,
        path: name,
      })),
      path: '',
      truncated: false,
    });

    const asMember = await drive(memberId).listFiles({});
    const asOwner = await drive(ownerId).listFiles({});

    expect(asMember.entries.map((entry) => entry.name)).toEqual(['projA', 'shared']);
    expect(asOwner.entries.map((entry) => entry.name)).toEqual(['projA', 'shared']);
    // Nested paths too: a recursive listing of the root reaches inside it.
    plane.listFiles.mockResolvedValue({
      entries: [{ isDirectory: false, name: 'key', path: 'secret/key' }],
      path: '',
      truncated: false,
    });
    expect((await drive(memberId).listFiles({ recursive: true })).entries).toEqual([]);
    await expect(drive(ownerId).readFile({ path: 'secret/.env' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    // Its owner is told what to do about it; nobody else learns it exists.
    const owned = await drive(ownerId).listInstances({ drive: 'public', withSizes: false });
    expect(owned.instances).toEqual([
      expect.objectContaining({ id: legacy.id, rebuildRequired: true }),
      expect.objectContaining({ rebuildRequired: false }),
    ]);
    const others = await drive(memberId).listInstances({ drive: 'public', withSizes: false });
    expect(others.instances.map((entry) => entry.rebuildRequired)).toEqual([false]);
  });

  it('builds nothing more into a private environment directory left there', async () => {
    const legacy = await legacyPrivateFolder(ownerId, 'secret');
    await serverDB
      .update(environmentInstances)
      .set({ configurationSnapshot: { bootstrapCommand: 'make' } })
      .where(eq(environmentInstances.id, legacy.id));

    await expect(drive(ownerId).startInstanceBuild({ id: legacy.id })).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'INSTANCE_REBUILD_REQUIRED',
    });
    await expect(
      drive(ownerId).copyInstance({ id: legacy.id, name: 'copy', workingDirectory: 'copy' }),
    ).rejects.toMatchObject({ message: 'INSTANCE_REBUILD_REQUIRED' });

    // What replaces it lands on the owner's personal drive.
    const rebuilt = await drive(ownerId).createInstanceForEnvironment({
      environmentId: legacy.environmentId,
    });
    expect(rebuilt.providerScope).toBe(personalKey(ownerId));
  });

  it('lets every member create, rename and delete ordinary folders at the root', async () => {
    await drive(memberId).createDirectory({ path: 'projB' });
    await drive(memberId).renameFile({ newPath: 'projC', path: 'projB' });
    await drive(memberId).removeFile({ path: 'projC', recursive: true });

    expect(plane.createDirectory).toHaveBeenCalledWith({ path: 'projB' });
    expect(plane.renameFile).toHaveBeenCalledWith({ newPath: 'projC', path: 'projB' });
    expect(plane.deleteFile).toHaveBeenCalledWith({ path: 'projC', recursive: true });
  });

  it('keeps every environment directory read-only from outside, its owner included', async () => {
    await initializeFolder(ownerId, 'atlas', 'public');

    for (const call of [
      () => drive(ownerId).writeFile({ content: 'x', path: 'atlas/notes.md' }),
      () => drive(ownerId).createDirectory({ path: 'atlas/sub' }),
      () => drive(memberId).removeFile({ path: 'atlas', recursive: true }),
      () => drive(memberId).renameFile({ newPath: 'atlas-old', path: 'atlas' }),
      () => drive(memberId).renameFile({ newPath: 'atlas/inside', path: 'projA' }),
    ]) {
      await expect(call()).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: 'INSTANCE_READ_ONLY',
      });
    }
    expect(plane.writeFile).not.toHaveBeenCalled();
    expect(plane.deleteFile).not.toHaveBeenCalled();
    expect(plane.renameFile).not.toHaveBeenCalled();
  });
});

describe('drive usage', () => {
  it("shows an admin each member's personal drive usage and nothing else of it", async () => {
    await serverDB.insert(workspaceMembers).values([
      { role: 'owner', userId: ownerId, workspaceId },
      { role: 'member', userId: memberId, workspaceId },
    ]);
    plane.getStorage.mockImplementation(async () => ({
      usageBytes: 5,
      workspaceUsageBytes: 15,
    }));

    const asAdmin = await sandboxStorageRouter
      .createCaller({ ...asMember(ownerId), workspaceRole: 'owner' })
      .getDriveUsage();
    const asMemberView = await sandboxStorageRouter
      .createCaller({ ...asMember(memberId), workspaceRole: 'member' })
      .getDriveUsage();

    expect(asAdmin).toMatchObject({
      drives: [
        { drive: 'public', usageBytes: 5 },
        { drive: 'personal', usageBytes: 5 },
      ],
      members: [{ usageBytes: 5, userId: memberId }],
      quotaBytes: 1,
      totalUsageBytes: 15,
    });
    expect(asMemberView.members).toBeNull();
    // The usage read is the only call made with the member's key.
    expect(plane.listFiles).not.toHaveBeenCalled();
  });
});
