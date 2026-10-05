// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type BackfillPool,
  backfillProjectWorkingDirectoryInstances,
} from '../../../../../scripts/backfillProjectWorkingDirectoryInstancesCore';
import { getTestDB } from '../../core/getTestDB';
import {
  agents,
  devices,
  environmentInstances,
  environments,
  projectEnvironments,
  projects,
  projectWorkingDirectories,
  users,
} from '../../schemas';
import { ProjectWorkingDirectoryModel } from '../projectWorkingDirectory';

const db = await getTestDB();
const userId = 'backfill-user';
const projectId = 'backfill-project';
const model = new ProjectWorkingDirectoryModel(db, userId);

/** The backfill speaks raw SQL; hand it the test database's underlying client. */
const pool: BackfillPool = {
  connect: async () => ({
    query: async (text, params) => (db as any).$client.query(text, params),
  }),
};

beforeEach(async () => {
  await db.insert(users).values({ id: userId });
  await db.insert(agents).values({ id: 'backfill-coordinator', userId });
  await db.insert(projects).values({
    coordinatorAgentId: 'backfill-coordinator',
    id: projectId,
    identifier: 'BKF',
    name: 'Backfill project',
    userId,
  });
});
afterEach(async () => {
  await db.delete(projectWorkingDirectories);
  await db.delete(projectEnvironments);
  await db.delete(environmentInstances);
  await db.delete(environments);
  await db.delete(devices);
  await db.delete(users);
});

const insertLegacyDirectory = async (path = '/work/repo') => {
  const [device] = await db
    .insert(devices)
    .values({ deviceId: `device-${path}`, identitySource: 'fallback', platform: 'linux', userId })
    .returning();
  const [directory] = await db
    .insert(projectWorkingDirectories)
    .values({ addedByUserId: userId, deviceId: device.id, name: 'Repo', path, projectId })
    .returning();
  return directory;
};

describe('backfillProjectWorkingDirectoryInstances', () => {
  it('upgrades a legacy directory so it resolves through an environment', async () => {
    const legacy = await insertLegacyDirectory();
    await expect(model.resolve(legacy.id)).rejects.toThrow();

    const progress = await backfillProjectWorkingDirectoryInstances(pool, {
      apply: true,
      batchSize: 10,
    });

    expect(progress).toMatchObject({ createdInstances: 1, scanned: 1, upgraded: 1 });
    await expect(model.resolve(legacy.id)).resolves.toMatchObject({ id: legacy.id });
  });

  it('is a no-op on a second run and leaves a dry run without writes', async () => {
    await insertLegacyDirectory();

    const dryRun = await backfillProjectWorkingDirectoryInstances(pool, {
      apply: false,
      batchSize: 10,
    });
    expect(dryRun).toMatchObject({ createdInstances: 1, scanned: 1 });
    expect(await db.select().from(environmentInstances)).toHaveLength(0);

    await backfillProjectWorkingDirectoryInstances(pool, { apply: true, batchSize: 10 });
    const rerun = await backfillProjectWorkingDirectoryInstances(pool, {
      apply: true,
      batchSize: 10,
    });
    expect(rerun.scanned).toBe(0);
  });

  it('links an existing instance instead of creating another one', async () => {
    const legacy = await insertLegacyDirectory();
    const [environment] = await db
      .insert(environments)
      .values({ configuration: {}, name: 'Existing', userId })
      .returning();
    await db.insert(environmentInstances).values({
      configurationSnapshot: {},
      deviceId: legacy.deviceId,
      environmentId: environment.id,
      kind: 'device',
      name: 'Existing',
      workingDirectory: legacy.path,
    });

    const progress = await backfillProjectWorkingDirectoryInstances(pool, {
      apply: true,
      batchSize: 10,
    });

    expect(progress).toMatchObject({ createdInstances: 0, upgraded: 1 });
    expect(await db.select().from(environmentInstances)).toHaveLength(1);
    await expect(model.resolve(legacy.id)).resolves.toMatchObject({
      environmentId: environment.id,
    });
  });
});
