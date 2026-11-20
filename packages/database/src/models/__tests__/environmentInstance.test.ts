// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { devices, environmentInstances, environments, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { EnvironmentInstanceModel, InstanceDirectoryOverlapError } from '../environmentInstance';

const db: LobeChatDatabase = await getTestDB();

const userId = 'env-instance-user';
const otherUserId = 'env-instance-other';
const workspaceId = 'env-instance-ws';

const model = new EnvironmentInstanceModel(db, userId);
const otherModel = new EnvironmentInstanceModel(db, otherUserId);

/** Every environment needs a unique (userId, workspaceId, name) — randomise it. */
const makeEnv = async (
  overrides: { visibility?: 'private' | 'public'; workspaceId?: string } = {},
) => {
  const [row] = await db
    .insert(environments)
    .values({
      configuration: { sources: [] },
      name: `env-${randomUUID()}`,
      userId,
      ...overrides,
    })
    .returning();
  return row;
};

const makeDevice = async () => {
  const [row] = await db
    .insert(devices)
    .values({ deviceId: `machine-${randomUUID()}`, identitySource: 'machine-id', userId })
    .returning();
  return row;
};

/** Provider-bound instance input; `providerResourceId` scopes the storage. */
const sandbox = (environmentId: string, name: string, dir: string, resource = 'r') => ({
  environmentId,
  kind: 'sandbox' as const,
  name,
  provider: 'e2b',
  providerResourceId: resource,
  providerScope: 'scope',
  workingDirectory: dir,
});

beforeEach(async () => {
  await db.delete(users);
  await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await db
    .insert(workspaces)
    .values({ id: workspaceId, name: 'ws', primaryOwnerId: userId, slug: workspaceId });
});

afterEach(async () => {
  await db.delete(environmentInstances);
  await db.delete(environments);
  await db.delete(devices);
  await db.delete(users);
});

describe('EnvironmentInstanceModel', () => {
  it('lists visible instances and narrows by environment id', async () => {
    const envA = await makeEnv();
    const envB = await makeEnv();
    const a = (await model.create(sandbox(envA.id, 'a', '/work/a', 'ra')))!;
    const b = (await model.create(sandbox(envB.id, 'b', '/work/b', 'rb')))!;

    const all = await model.query();
    expect(all.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());

    const onlyA = await model.query({ environmentId: envA.id });
    expect(onlyA.map((r) => r.id)).toEqual([a.id]);
  });

  it('resolves instances through visibility and ownership', async () => {
    const env = await makeEnv();
    const row = (await model.create(sandbox(env.id, 'x', '/work/x')))!;

    await expect(model.findById(row.id)).resolves.toMatchObject({ id: row.id });
    await expect(model.findOwnedById(row.id)).resolves.toMatchObject({ id: row.id });
    await expect(model.findByWorkingDirectory('/work/x')).resolves.toMatchObject({ id: row.id });
    await expect(model.findByWorkingDirectory('/work/missing')).resolves.toBeUndefined();
    // No device binding → the device+directory lookup finds nothing.
    await expect(
      model.findByDeviceAndDirectory('00000000-0000-0000-0000-000000000000', '/work/x'),
    ).resolves.toBeUndefined();

    // A personal environment's instance is invisible to (and not owned by) another user.
    await expect(otherModel.findById(row.id)).resolves.toBeUndefined();
    await expect(otherModel.findOwnedById(row.id)).resolves.toBeUndefined();
  });

  it('refuses to create an instance in an environment the caller does not own', async () => {
    const env = await makeEnv({ visibility: 'public', workspaceId });
    const created = await otherModel.create(sandbox(env.id, 'nope', '/work/nope'));

    expect(created).toBeUndefined();
  });

  it('creates device-bound instances and resolves them by device and directory', async () => {
    const device = await makeDevice();
    const env = await makeEnv();

    const row = (await model.create({
      deviceId: device.id,
      environmentId: env.id,
      kind: 'device',
      name: 'd',
      workingDirectory: '/work/d',
    }))!;
    expect(row.kind).toBe('device');

    await expect(model.findByDeviceAndDirectory(device.id, '/work/d')).resolves.toMatchObject({
      id: row.id,
    });

    const direct = await model.createForDeviceBinding({
      configurationSnapshot: { sources: [] },
      deviceId: device.id,
      environmentId: env.id,
      name: 'd2',
      workingDirectory: '/work/d2',
    });
    expect(direct).toMatchObject({ kind: 'device', workingDirectory: '/work/d2' });
  });

  it('rejects a directory that overlaps an existing instance on the same storage', async () => {
    const env = await makeEnv();
    await model.create(sandbox(env.id, 'app', '/work/app'));

    await expect(model.create(sandbox(env.id, 'nested', '/work/app/sub'))).rejects.toBeInstanceOf(
      InstanceDirectoryOverlapError,
    );
  });

  it('rejects a binding that declares neither a device nor a provider resource', async () => {
    const env = await makeEnv();
    // With no device the binding falls back to the provider triple; all three are
    // empty here, so the row fails the `environment_instances_binding` check.
    await expect(
      model.create({
        environmentId: env.id,
        kind: 'device',
        name: 'malformed',
        workingDirectory: '/work/malformed',
      }),
    ).rejects.toThrow();
  });

  it('snapshots the environment configuration unless one is supplied', async () => {
    const configuration = {
      sources: [{ kind: 'git' as const, url: 'https://github.com/lobehub/lobehub' }],
    };
    const [env] = await db
      .insert(environments)
      .values({ configuration, name: `env-${randomUUID()}`, userId })
      .returning();

    const defaulted = (await model.create(sandbox(env.id, 's1', '/work/s1', 'r1')))!;
    expect(defaulted.configurationSnapshot).toEqual(configuration);

    const explicit = (await model.create({
      ...sandbox(env.id, 's2', '/work/s2', 'r2'),
      configurationSnapshot: { sources: [] },
    }))!;
    expect(explicit.configurationSnapshot).toEqual({ sources: [] });
  });

  it('records a build verdict only for the matching build id', async () => {
    const env = await makeEnv();
    const row = (await model.create(sandbox(env.id, 'b', '/work/b')))!;
    await model.update(row.id, { buildId: 'build-1' });

    await model.recordBuildResult(row.id, 'stale-build', { buildError: null, status: 'ready' });
    let reread = (await model.findById(row.id))!;
    expect(reread.status).toBe('pending');
    expect(reread.buildId).toBe('build-1');

    await model.recordBuildResult(row.id, 'build-1', { buildError: 'boom', status: 'error' });
    reread = (await model.findById(row.id))!;
    expect(reread).toMatchObject({ buildError: 'boom', buildId: null, status: 'error' });
  });

  it('scopes updates and deletes to the owner of the environment', async () => {
    const env = await makeEnv();
    const row = (await model.create(sandbox(env.id, 'u', '/work/u')))!;

    await expect(otherModel.update(row.id, { name: 'hijack' })).resolves.toBeUndefined();
    await expect(otherModel.delete(row.id)).resolves.toBeUndefined();

    await expect(model.update(row.id, { enabled: false })).resolves.toMatchObject({ id: row.id });
    await expect(model.delete(row.id)).resolves.toMatchObject({ id: row.id });
  });

  it('shows a published workspace environment to members while keeping a public agent out of a private one', async () => {
    const publicEnv = await makeEnv({ visibility: 'public', workspaceId });
    const privateEnv = await makeEnv({ visibility: 'private', workspaceId });
    const owner = new EnvironmentInstanceModel(db, userId, workspaceId);

    const pubRow = (await owner.create(sandbox(publicEnv.id, 'pub', '/work/pub', 'r1')))!;
    const privRow = (await owner.create(sandbox(privateEnv.id, 'priv', '/work/priv', 'r2')))!;

    const member = new EnvironmentInstanceModel(db, otherUserId, workspaceId);
    await expect(member.findById(pubRow.id)).resolves.toMatchObject({ id: pubRow.id });
    await expect(member.findById(privRow.id)).resolves.toBeUndefined();

    // A workspace-public agent may read published rows only — never a private one.
    const publicAgent = new EnvironmentInstanceModel(db, userId, workspaceId, 'public');
    await expect(publicAgent.findById(pubRow.id)).resolves.toMatchObject({ id: pubRow.id });
    await expect(publicAgent.findById(privRow.id)).resolves.toBeUndefined();
  });
});
