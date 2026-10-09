// @vitest-environment node
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type BackfillPool,
  backfillProjectWorkingDirectoryInstances,
  SELECT_LEGACY_DIRECTORIES,
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

  // The cursor advances to the last row of each batch, so a scan that drops a
  // qualifying row from its window strands that row *behind* the cursor: it is
  // never revisited and the run reports completion anyway. `SKIP LOCKED` used
  // to do exactly that whenever a row was briefly locked, so the scan must wait
  // for the lock instead of stepping over it.
  //
  // Under the client-db PGlite engine every statement shares one session, so the
  // lock belongs to the scanning transaction itself and cannot be skipped; the
  // real assertion needs a node-postgres pool (`TEST_SERVER_DB=1`) where the
  // holder and the scan run on separate connections.
  it('keeps a locked row in the cursor window instead of skipping past it', async () => {
    const a = await insertLegacyDirectory('/work/a');
    const b = await insertLegacyDirectory('/work/b');
    const earlier = a.id < b.id ? a : b;

    let markLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      markLocked = resolve;
    });
    let releaseLock!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    const holding = db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT id FROM project_working_directories WHERE id = ${earlier.id} FOR UPDATE`,
      );
      markLocked();
      await gate;
    });

    await locked;

    const scan = (db as any).$client.query(SELECT_LEGACY_DIRECTORIES, [
      '00000000-0000-0000-0000-000000000000',
      1,
    ]);
    // Let the scan reach the locked row before the holder goes away.
    await new Promise((resolve) => setTimeout(resolve, 200));
    releaseLock();
    await holding;

    const { rows } = await scan;
    expect(rows.map((row: { id: string }) => row.id)).toEqual([earlier.id]);
  });
});
